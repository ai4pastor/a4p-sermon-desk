// 노트 단위 색인 행 정리 — 순수 sql.js 모듈(obsidian 무의존, 테스트 가능).
// FK는 applySchema에서만 ON이고 기존 DB를 로드한 세션에서는 OFF이므로
// CASCADE에 의존하지 않고 자식→부모 순으로 직접 지운다.
import type { Database } from "sql.js";

/**
 * 노트들의 색인 흔적을 자식→부모 순으로 제거 (FK OFF 세션에서도 안전).
 * @returns 실제로 지워진 notes 행 수(없던 경로는 0으로 셈 — 멱등).
 */
export function deleteNoteRows(db: Database, paths: string[]): number {
	if (paths.length === 0) return 0;
	const stmts = [
		"DELETE FROM chunk_terms WHERE chunk_id IN (SELECT id FROM chunks WHERE note_path = ?)",
		"DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE note_path = ?)",
		"DELETE FROM chunks WHERE note_path = ?",
		"DELETE FROM note_lexicon_keys WHERE note_path = ?",
		"DELETE FROM note_tags WHERE note_path = ?",
		"DELETE FROM notes WHERE path = ?",
	].map((sql) => db.prepare(sql));
	let removed = 0;
	try {
		for (const p of paths) {
			for (const s of stmts) s.run([p]);
			removed += db.getRowsModified();
		}
	} finally {
		for (const s of stmts) s.free();
	}
	return removed;
}

function folderPrefix(folderPath: string): string {
	return folderPath.endsWith("/") ? folderPath : folderPath + "/";
}

/** 폴더(하위 폴더 포함) 안의 색인된 노트 경로 — `A/`로 시작하는 것만(`AB/`는 제외). */
export function listNotesUnderFolder(
	db: Database,
	folderPath: string,
): string[] {
	const prefix = folderPrefix(folderPath);
	const rows = db.exec("SELECT path FROM notes WHERE substr(path, 1, ?) = ?", [
		prefix.length,
		prefix,
	]);
	return rows[0] ? rows[0].values.map((r) => String(r[0])) : [];
}

/** 폴더 삭제 — 하위 노트 행 전부 제거. 지운 경로를 반환. */
export function deleteNotesUnderFolder(
	db: Database,
	folderPath: string,
): string[] {
	const paths = listNotesUnderFolder(db, folderPath);
	deleteNoteRows(db, paths);
	return paths;
}

export interface NoteCategory {
	groupId: string;
	weight: number;
}

/**
 * 노트 경로 변경 — 청크·임베딩을 보존한 채 경로만 옮긴다(임베딩 API 비용 0).
 * 순서: 새 부모 행 삽입 → 자식(chunks·note_tags·note_lexicon_keys) 경로 갱신 →
 * 옛 부모 삭제. FK ON(새 DB·테스트)에서도 위반이 없고 FK OFF에서도 같다.
 * cat이 null이면(새 경로가 색인 범위 밖·제외 폴더) 행을 삭제한다.
 * @returns notes에 oldPath가 있어 실제로 처리했으면 true, 색인 밖 노트면 false(no-op).
 */
export function renameNoteRows(
	db: Database,
	oldPath: string,
	newPath: string,
	cat: NoteCategory | null,
): boolean {
	if (oldPath === newPath) return false;
	const exists = db.exec("SELECT 1 FROM notes WHERE path = ?", [oldPath]);
	if (!exists[0]) return false;
	if (cat === null) {
		deleteNoteRows(db, [oldPath]);
		return true;
	}
	db.exec("BEGIN TRANSACTION");
	try {
		// 새 경로에 낡은 행이 남아 있으면(비정상) 먼저 정리 — 그렇지 않으면 PK 충돌
		deleteNoteRows(db, [newPath]);
		db.run(
			"INSERT INTO notes(path, mtime, size, category_id, weight, indexed_at) SELECT ?, mtime, size, ?, ?, indexed_at FROM notes WHERE path = ?",
			[newPath, cat.groupId, cat.weight, oldPath],
		);
		db.run("UPDATE chunks SET note_path = ? WHERE note_path = ?", [
			newPath,
			oldPath,
		]);
		db.run("UPDATE note_tags SET note_path = ? WHERE note_path = ?", [
			newPath,
			oldPath,
		]);
		db.run(
			"UPDATE note_lexicon_keys SET note_path = ? WHERE note_path = ?",
			[newPath, oldPath],
		);
		db.run("DELETE FROM notes WHERE path = ?", [oldPath]);
		db.exec("COMMIT");
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	}
	return true;
}
