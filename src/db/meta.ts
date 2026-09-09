import type { Database } from "sql.js";

export const FOLDERS_FP_KEY = "index_folders_fingerprint";
/** 색인 알고리즘 버전 — indexer.INDEX_ALGO_VERSION과 불일치하면 전체 재색인 강제. */
export const ALGO_VERSION_KEY = "index_algo_version";
/** doctrine 렉시콘 지문 — 변경 시 불변 노트의 note_doctrines/note_tags만 재계산. */
export const DOCTRINE_FP_KEY = "index_doctrine_fingerprint";
/** 형태소 보호 단어 지문 — 불일치면 chunk_terms 재계산(임베딩 유지) 안내. */
export const PROTECTED_FP_KEY = "index_protected_fingerprint";

export function getMeta(db: Database, key: string): string | null {
	const r = db.exec("SELECT value FROM meta WHERE key = ?", [key]);
	const v = r[0]?.values[0]?.[0];
	return v != null ? String(v) : null;
}

export function setMeta(db: Database, key: string, value: string): void {
	db.run("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", [key, value]);
}
