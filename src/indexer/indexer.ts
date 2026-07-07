import { App, TFile } from "obsidian";
import type { Database } from "sql.js";
import { type WeightedRecallSettings, foldersFingerprint } from "../settings";
import { scanVault, reapplyFolderSettings, type NoteRecord } from "./scanner";
import {
	getMeta,
	setMeta,
	FOLDERS_FP_KEY,
	ALGO_VERSION_KEY,
	DOCTRINE_FP_KEY,
} from "../db/meta";
import { parseFile } from "./parser";
import { chunkBody } from "./chunker";
import { tokenize } from "../morpheme";
import { normalizeTag } from "../search/tag";

/**
 * 토큰화/색인 알고리즘 버전 — heading 포함(0.2.0) + NFC 정규화(0.3.0) = 2.
 * tokenize/chunk 로직이 바뀌면 올릴 것. meta와 불일치하면 전체 재색인을 강제한다.
 */
export const INDEX_ALGO_VERSION = 2;

export interface SlowChunkInfo {
	path: string;
	heading: string | null;
	ord: number;
	chars: number;
	ms: number;
}

export interface IndexTimings {
	parseMs: number;
	chunkMs: number;
	morphemeMs: number;
	insertChunkMs: number;
	insertTermMs: number;
	yieldMs: number;
	totalTerms: number;
	morphemeMin: number;
	morphemeMax: number;
	morphemeP50: number;
	morphemeP95: number;
	slowestChunks: SlowChunkInfo[];
}

export interface IndexResult {
	mode: "full" | "incremental";
	added: number;
	updated: number;
	removed: number;
	unchanged: number;
	/** 이번에 삽입된 청크 수. */
	chunks: number;
	timings: IndexTimings;
}

export interface IndexOptions {
	onProgress?: (done: number, total: number) => void;
	/** true면 변경 감지 없이 전체 재색인(임베딩도 전량 재생성됨). */
	force?: boolean;
}

/** 한 노트의 색인 흔적을 자식→부모 순으로 제거 (FK OFF 세션에서도 안전). */
function deleteNoteRows(db: Database, paths: string[]): void {
	if (paths.length === 0) return;
	const stmts = [
		"DELETE FROM chunk_terms WHERE chunk_id IN (SELECT id FROM chunks WHERE note_path = ?)",
		"DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE note_path = ?)",
		"DELETE FROM chunks WHERE note_path = ?",
		"DELETE FROM note_doctrines WHERE note_path = ?",
		"DELETE FROM note_tags WHERE note_path = ?",
		"DELETE FROM notes WHERE path = ?",
	].map((sql) => db.prepare(sql));
	try {
		for (const p of paths) {
			for (const s of stmts) s.run([p]);
		}
	} finally {
		for (const s of stmts) s.free();
	}
}

export async function runIndex(
	app: App,
	db: Database,
	settings: WeightedRecallSettings,
	options: IndexOptions = {},
): Promise<IndexResult> {
	const records = scanVault(app, settings);
	const now = Date.now();

	const doctrineLexicon = new Set(
		settings.doctrineKeywords
			.map((k) => normalizeTag(k))
			.filter((k) => k.length > 0),
	);
	const doctrineFp = [...doctrineLexicon].sort().join("|");

	// 알고리즘 버전 불일치(첫 실행·업그레이드 포함)면 전체 재색인 강제.
	const full =
		options.force === true ||
		getMeta(db, ALGO_VERSION_KEY) !== String(INDEX_ALGO_VERSION);
	const lexiconChanged =
		!full && getMeta(db, DOCTRINE_FP_KEY) !== doctrineFp;

	// 기존 색인과 diff — 신규/변경만 다시 읽고, 사라진 노트는 정리한다.
	// rename은 구경로 removed + 신경로 added로, 폴더 스코프 변경은 scan 결과
	// 차이로 자연 처리된다.
	const toIndex: NoteRecord[] = [];
	const unchangedRecs: NoteRecord[] = [];
	const updatedPaths: string[] = [];
	let removedPaths: string[] = [];
	if (full) {
		toIndex.push(...records);
	} else {
		const existing = new Map<string, { mtime: number; size: number }>();
		const rows = db.exec("SELECT path, mtime, size FROM notes");
		if (rows[0]) {
			for (const r of rows[0].values) {
				existing.set(String(r[0]), {
					mtime: Number(r[1]),
					size: Number(r[2]),
				});
			}
		}
		const seen = new Set<string>();
		for (const rec of records) {
			seen.add(rec.path);
			const prev = existing.get(rec.path);
			if (!prev) {
				toIndex.push(rec);
			} else if (prev.mtime !== rec.mtime || prev.size !== rec.size) {
				toIndex.push(rec);
				updatedPaths.push(rec.path);
			} else {
				unchangedRecs.push(rec);
			}
		}
		removedPaths = [...existing.keys()].filter((p) => !seen.has(p));
	}
	const total =
		toIndex.length + (lexiconChanged ? unchangedRecs.length : 0);
	let done = 0;

	db.exec("BEGIN TRANSACTION");
	const insertNote = db.prepare(
		"INSERT INTO notes(path, mtime, size, category_id, weight, indexed_at) VALUES (?, ?, ?, ?, ?, ?)",
	);
	const insertChunk = db.prepare(
		"INSERT INTO chunks(note_path, ord, heading, text) VALUES (?, ?, ?, ?)",
	);
	const insertTerm = db.prepare(
		"INSERT INTO chunk_terms(chunk_id, term) VALUES (?, ?)",
	);
	const insertNoteDoctrine = db.prepare(
		"INSERT OR IGNORE INTO note_doctrines(note_path, doctrine_key) VALUES (?, ?)",
	);
	const insertNoteTag = db.prepare(
		"INSERT OR IGNORE INTO note_tags(note_path, tag_key) VALUES (?, ?)",
	);

	const timings: IndexTimings = {
		parseMs: 0,
		chunkMs: 0,
		morphemeMs: 0,
		insertChunkMs: 0,
		insertTermMs: 0,
		yieldMs: 0,
		totalTerms: 0,
		morphemeMin: 0,
		morphemeMax: 0,
		morphemeP50: 0,
		morphemeP95: 0,
		slowestChunks: [],
	};
	const chunkMorphemeMs: number[] = [];
	const chunkInfo: SlowChunkInfo[] = [];

	try {
		if (full) {
			db.exec(
				"DELETE FROM chunk_terms; DELETE FROM embeddings; DELETE FROM chunks; DELETE FROM note_doctrines; DELETE FROM note_tags; DELETE FROM notes;",
			);
		} else {
			deleteNoteRows(db, [...removedPaths, ...updatedPaths]);
		}

		let totalChunks = 0;
		for (let i = 0; i < toIndex.length; i++) {
			const rec = toIndex[i];
			const file = app.vault.getAbstractFileByPath(rec.path);
			if (!(file instanceof TFile)) continue;

			insertNote.run([
				rec.path,
				rec.mtime,
				rec.size,
				rec.groupId,
				rec.weight,
				now,
			]);

			let t = performance.now();
			const parsed = await parseFile(app, file, doctrineLexicon);
			timings.parseMs += performance.now() - t;

			for (const dk of parsed.doctrineKeys) {
				insertNoteDoctrine.run([rec.path, dk]);
			}
			for (const tk of parsed.tagKeys) {
				insertNoteTag.run([rec.path, tk]);
			}

			t = performance.now();
			const chunks = chunkBody(parsed.body);
			timings.chunkMs += performance.now() - t;

			const tagPrefix =
				parsed.tags.length > 0
					? `[태그: ${parsed.tags.join(", ")}] `
					: "";

			for (const chunk of chunks) {
				const chunkText = tagPrefix + chunk.text;
				t = performance.now();
				insertChunk.run([rec.path, chunk.ord, chunk.heading, chunkText]);
				const idRow = db.exec("SELECT last_insert_rowid()")[0];
				const chunkId = Number(idRow.values[0][0]);
				timings.insertChunkMs += performance.now() - t;

				t = performance.now();
				// heading도 검색 대상에 포함 — 주제어가 제목에만 있는 노트 누락 방지.
				const terms = await tokenize(
					chunk.heading ? `${chunk.heading}\n${chunkText}` : chunkText,
				);
				const dt = performance.now() - t;
				timings.morphemeMs += dt;
				chunkMorphemeMs.push(dt);
				chunkInfo.push({
					path: rec.path,
					heading: chunk.heading,
					ord: chunk.ord,
					chars: chunk.text.length,
					ms: dt,
				});

				t = performance.now();
				for (const term of terms) {
					insertTerm.run([chunkId, term]);
					timings.totalTerms++;
				}
				timings.insertTermMs += performance.now() - t;

				totalChunks++;
			}

			done++;
			options.onProgress?.(done, total);
			t = performance.now();
			await new Promise((r) => setTimeout(r, 0));
			timings.yieldMs += performance.now() - t;
		}

		if (lexiconChanged) {
			// 경량 렉시콘 재적용 — 불변 노트의 note_doctrines/note_tags만 재계산.
			// parseFile은 metadataCache 기반(tokenize 없음)이라 저렴하고,
			// chunks/embeddings는 건드리지 않는다(tagPrefix는 렉시콘 무관).
			const delDoc = db.prepare(
				"DELETE FROM note_doctrines WHERE note_path = ?",
			);
			const delTag = db.prepare("DELETE FROM note_tags WHERE note_path = ?");
			try {
				for (let i = 0; i < unchangedRecs.length; i++) {
					const rec = unchangedRecs[i];
					const file = app.vault.getAbstractFileByPath(rec.path);
					if (!(file instanceof TFile)) continue;
					const parsed = await parseFile(app, file, doctrineLexicon);
					delDoc.run([rec.path]);
					delTag.run([rec.path]);
					for (const dk of parsed.doctrineKeys) {
						insertNoteDoctrine.run([rec.path, dk]);
					}
					for (const tk of parsed.tagKeys) {
						insertNoteTag.run([rec.path, tk]);
					}
					done++;
					options.onProgress?.(done, total);
					if (i % 50 === 49) {
						await new Promise((r) => setTimeout(r, 0));
					}
				}
			} finally {
				delDoc.free();
				delTag.free();
			}
		}

		// COMMIT과 함께 원자적으로 기록 — 중단 시 다음 실행이 다시 판정한다.
		setMeta(db, ALGO_VERSION_KEY, String(INDEX_ALGO_VERSION));
		setMeta(db, DOCTRINE_FP_KEY, doctrineFp);
		db.exec("COMMIT");
		if (full) {
			setMeta(db, FOLDERS_FP_KEY, foldersFingerprint(settings));
		} else {
			// 불변 노트의 그룹/가중치도 현재 설정으로 최신화 (자체 트랜잭션 사용).
			reapplyFolderSettings(db, settings);
		}
		if (chunkMorphemeMs.length > 0) {
			const sorted = [...chunkMorphemeMs].sort((a, b) => a - b);
			const pick = (q: number) =>
				sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
			timings.morphemeMin = sorted[0];
			timings.morphemeMax = sorted[sorted.length - 1];
			timings.morphemeP50 = pick(0.5);
			timings.morphemeP95 = pick(0.95);
			timings.slowestChunks = [...chunkInfo]
				.sort((a, b) => b.ms - a.ms)
				.slice(0, 5);
		}
		return {
			mode: full ? "full" : "incremental",
			added: full ? toIndex.length : toIndex.length - updatedPaths.length,
			updated: full ? 0 : updatedPaths.length,
			removed: removedPaths.length,
			unchanged: unchangedRecs.length,
			chunks: totalChunks,
			timings,
		};
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	} finally {
		insertNote.free();
		insertChunk.free();
		insertTerm.free();
		insertNoteDoctrine.free();
		insertNoteTag.free();
	}
}
