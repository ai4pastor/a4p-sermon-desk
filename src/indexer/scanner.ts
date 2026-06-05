import { App } from "obsidian";
import type { Database } from "sql.js";
import {
	WeightedRecallSettings,
	isPathExcluded,
	longestPrefixFolder,
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
	if (isPathExcluded(settings, path)) return null;
	const entry = longestPrefixFolder(settings, path);
	if (!entry || entry.weight === 0) return null;
	return { groupId: entry.groupId, weight: weightToInternal(entry.weight) };
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

/**
 * 경량 재적용 — 전체 재색인 없이 기존 notes의 그룹/가중치만 갱신한다.
 * 텍스트·청크·임베딩은 건드리지 않는다(비파괴). 미매칭/0점 폴더는 weight 0으로
 * 밀어내며(검색에서 사실상 제외), 완전 삭제는 전체 재색인이 처리한다.
 */
export function reapplyFolderSettings(
	db: Database,
	settings: WeightedRecallSettings,
): { updated: number } {
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
	setMeta(db, FOLDERS_FP_KEY, foldersFingerprint(settings));
	return { updated };
}
