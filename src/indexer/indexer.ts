import { App, TFile } from "obsidian";
import type { Database } from "sql.js";
import { type WeightedRecallSettings, foldersFingerprint } from "../settings";
import { scanVault } from "./scanner";
import { setMeta, FOLDERS_FP_KEY } from "../db/meta";
import { parseFile } from "./parser";
import { chunkBody } from "./chunker";
import { tokenize } from "../morpheme";
import { normalizeTag } from "../search/tag";

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
	notes: number;
	chunks: number;
	timings: IndexTimings;
}

export interface IndexOptions {
	onProgress?: (done: number, total: number) => void;
}

export async function runFullIndex(
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
		db.exec(
			"DELETE FROM chunk_terms; DELETE FROM embeddings; DELETE FROM chunks; DELETE FROM note_doctrines; DELETE FROM note_tags; DELETE FROM notes;",
		);

		let totalChunks = 0;
		for (let i = 0; i < records.length; i++) {
			const rec = records[i];
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
				const terms = await tokenize(chunkText);
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

			options.onProgress?.(i + 1, records.length);
			t = performance.now();
			await new Promise((r) => setTimeout(r, 0));
			timings.yieldMs += performance.now() - t;
		}

		db.exec("COMMIT");
		setMeta(db, FOLDERS_FP_KEY, foldersFingerprint(settings));
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
		return { notes: records.length, chunks: totalChunks, timings };
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
