import { App } from "obsidian";
import type { Database } from "sql.js";
import {
	WeightedRecallSettings,
	longestPrefixFolder,
	scopeWeight10,
	weightToInternal,
	foldersFingerprint,
} from "../settings";
import { setMeta, FOLDERS_FP_KEY } from "../db/meta";

export interface NoteRecord {
	path: string;
	mtime: number;
	size: number;
	/** notes.category_id 컬럼에 저장되는 그룹("internal"/"external"). */
	groupId: string;
	weight: number;
}

export function categorizeFile(
	path: string,
	settings: WeightedRecallSettings,
): { groupId: string; weight: number } | null {
	// notes.weight에는 "전 프로파일 최대(scope)" 배율을 저장한다 — 어떤 프로파일이라도
	// 쓰는 노트는 인덱스에 있어야 하고, SQL의 weight > 0은 scope 게이트가 된다.
	// 활성 프로파일의 실제 가중치는 검색 시점의 resolveWeight가 곱한다.
	const w10 = scopeWeight10(settings, path);
	if (w10 === 0) return null;
	const entry = longestPrefixFolder(settings, path);
	if (!entry) return null;
	return { groupId: entry.groupId, weight: weightToInternal(w10) };
}

export function scanVault(
	app: App,
	settings: WeightedRecallSettings,
): NoteRecord[] {
	const records: NoteRecord[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const cat = categorizeFile(file.path, settings);
		if (!cat) continue;
		records.push({
			path: file.path,
			mtime: file.stat.mtime,
			size: file.stat.size,
			groupId: cat.groupId,
			weight: cat.weight,
		});
	}
	records.sort((a, b) => a.path.localeCompare(b.path));
	return records;
}

/** 색인 범위(scopePaths) 중 notes 테이블에 없는 노트 수 — 배너 안내·재적용 판정용. */
export function countUnindexed(db: Database, scopePaths: string[]): number {
	const rows = db.exec("SELECT path FROM notes");
	const indexed = new Set(
		rows[0] ? rows[0].values.map((r) => String(r[0])) : [],
	);
	let n = 0;
	for (const p of scopePaths) if (!indexed.has(p)) n++;
	return n;
}

/**
 * 경량 재적용 — 전체 재색인 없이 기존 notes의 그룹/가중치만 갱신한다.
 * 텍스트·청크·임베딩은 건드리지 않는다(비파괴). 미매칭/0점 폴더는 weight 0으로
 * 밀어내며(검색에서 사실상 제외), 완전 삭제는 전체 재색인이 처리한다.
 *
 * scopePaths = 현재 설정으로 색인 범위에 드는 노트 경로(scanVault 결과). 이 중
 * notes에 없는 경로(missing)가 있으면 — 0점이던 폴더를 살렸거나 폴더를 새로 추가한
 * 경우 — 그 내용은 아직 인덱스에 없으므로 폴더 지문을 기록하지 않는다(배너가
 * "재색인 필요"로 남는다). 지문은 missing이 0일 때만 갱신된다.
 */
export function reapplyFolderSettings(
	db: Database,
	settings: WeightedRecallSettings,
	scopePaths: string[],
): { updated: number; missing: number } {
	const rows = db.exec("SELECT path FROM notes");
	const paths = rows[0] ? rows[0].values.map((r) => String(r[0])) : [];
	db.exec("BEGIN TRANSACTION");
	const upd = db.prepare(
		"UPDATE notes SET category_id = ?, weight = ? WHERE path = ?",
	);
	let updated = 0;
	try {
		for (const p of paths) {
			const cat = categorizeFile(p, settings);
			if (cat) {
				upd.run([cat.groupId, cat.weight, p]);
			} else {
				upd.run([null, 0, p]);
			}
			updated++;
		}
		db.exec("COMMIT");
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	} finally {
		upd.free();
	}
	const missing = countUnindexed(db, scopePaths);
	if (missing === 0) {
		setMeta(db, FOLDERS_FP_KEY, foldersFingerprint(settings));
	}
	return { updated, missing };
}
