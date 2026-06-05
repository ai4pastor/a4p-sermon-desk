import type { Database } from "sql.js";

export const FOLDERS_FP_KEY = "index_folders_fingerprint";

export function getMeta(db: Database, key: string): string | null {
	const r = db.exec("SELECT value FROM meta WHERE key = ?", [key]);
	const v = r[0]?.values[0]?.[0];
	return v != null ? String(v) : null;
}

export function setMeta(db: Database, key: string, value: string): void {
	db.run("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", [key, value]);
}
