// 스키마 v2 → v3 마이그레이션 — 교리 전용 테이블(note_doctrines·doctrine_embeddings·tag_embeddings)을
// 렉시콘 테이블(note_lexicon_keys·key_embeddings)로 무손실 복사하는지 검증. 실 DB 사본은 ranking-live가 맡는다.
import { describe, it, expect, beforeAll } from "vitest";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import path from "node:path";
import { runMigrations } from "../src/db/migrate";
import { SCHEMA_VERSION } from "../src/db/schema";
import {
	floatToBlob,
	getDistinctLexiconKeys,
	getKeyEmbedding,
	lexScope,
	loadAllKeyEmbeddings,
	TAG_SCOPE,
} from "../src/db/embeddings";

/** 0.3.0~0.11.x 설치본의 실제 v2 DDL(schema.ts 옛 버전 그대로). */
const V2_DDL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notes (
  path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL,
  category_id TEXT, weight REAL NOT NULL DEFAULT 1.0, indexed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, note_path TEXT NOT NULL, ord INTEGER NOT NULL,
  heading TEXT, text TEXT NOT NULL,
  FOREIGN KEY (note_path) REFERENCES notes(path) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id INTEGER PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chunk_terms (
  chunk_id INTEGER NOT NULL, term TEXT NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS note_doctrines (
  note_path TEXT NOT NULL, doctrine_key TEXT NOT NULL,
  PRIMARY KEY (note_path, doctrine_key),
  FOREIGN KEY (note_path) REFERENCES notes(path) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS note_tags (
  note_path TEXT NOT NULL, tag_key TEXT NOT NULL,
  PRIMARY KEY (note_path, tag_key),
  FOREIGN KEY (note_path) REFERENCES notes(path) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS doctrine_embeddings (
  key TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL, embedded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tag_embeddings (
  key TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL, embedded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_note ON chunks(note_path);
CREATE INDEX IF NOT EXISTS idx_note_doctrines_key ON note_doctrines(doctrine_key);
CREATE INDEX IF NOT EXISTS idx_note_tags_key ON note_tags(tag_key);
INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '2');
INSERT OR REPLACE INTO meta(key, value) VALUES ('index_doctrine_fingerprint', '성화|칭의');
`;

let SQL: SqlJsStatic;
beforeAll(async () => {
	SQL = await initSqlJs({
		locateFile: (f: string) =>
			path.resolve(process.cwd(), "node_modules/sql.js/dist", f),
	});
});

function makeV2(): Database {
	const db = new SQL.Database();
	db.exec(V2_DDL);
	for (const p of ["a.md", "b.md"]) {
		db.run(
			"INSERT INTO notes(path, mtime, size, category_id, weight, indexed_at) VALUES (?, 0, 0, 'internal', 1.0, 0)",
			[p],
		);
	}
	db.run("INSERT INTO chunks(id, note_path, ord, heading, text) VALUES (1, 'a.md', 0, NULL, '칭의 본문')");
	for (const [p, k] of [
		["a.md", "칭의"],
		["a.md", "성화"],
		["b.md", "칭의"],
	]) {
		db.run("INSERT INTO note_doctrines(note_path, doctrine_key) VALUES (?, ?)", [p, k]);
	}
	db.run("INSERT INTO note_tags(note_path, tag_key) VALUES ('a.md', '감사')");
	const emb = (table: string, key: string, vec: number[], at: number) =>
		db.run(
			`INSERT INTO ${table}(key, model, dim, vector, embedded_at) VALUES (?, 'm', ?, ?, ?)`,
			[key, vec.length, floatToBlob(Float32Array.from(vec)), at],
		);
	emb("doctrine_embeddings", "칭의", [1, 2], 111);
	emb("doctrine_embeddings", "성화", [3, 4], 222);
	emb("tag_embeddings", "감사", [5, 6], 333);
	emb("tag_embeddings", "기도", [7, 8], 444);
	return db;
}

function tables(db: Database): string[] {
	return (
		db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0]?.values.map((r) =>
			String(r[0]),
		) ?? []
	);
}
function count(db: Database, sql: string): number {
	return Number(db.exec(sql)[0].values[0][0]);
}
function meta(db: Database, key: string): unknown {
	return db.exec("SELECT value FROM meta WHERE key=?", [key])[0]?.values[0]?.[0];
}

describe("runMigrations v2 → v3 (렉시콘 테이블)", () => {
	it("행을 무손실 복사하고 구 테이블을 없애며 schema_version=3", () => {
		const db = makeV2();
		try {
			expect(runMigrations(db)).toBe(true);
			expect(meta(db, "schema_version")).toBe(String(SCHEMA_VERSION));
			// 다른 meta는 보존(재도출 지문은 커밋 3에서 값 형식이 바뀌어 첫 재색인이 재도출)
			expect(meta(db, "index_doctrine_fingerprint")).toBe("성화|칭의");

			expect(count(db, "SELECT COUNT(*) FROM note_lexicon_keys")).toBe(3);
			expect(count(db, "SELECT COUNT(*) FROM note_lexicon_keys WHERE lexicon_id='doctrine'")).toBe(3);
			expect(getDistinctLexiconKeys(db, ["doctrine"])).toEqual(["성화", "칭의"]);
			expect(getDistinctLexiconKeys(db, [])).toEqual([]);

			expect(count(db, `SELECT COUNT(*) FROM key_embeddings WHERE scope='${lexScope("doctrine")}'`)).toBe(2);
			expect(count(db, `SELECT COUNT(*) FROM key_embeddings WHERE scope='${TAG_SCOPE}'`)).toBe(2);
			expect(Array.from(getKeyEmbedding(db, lexScope("doctrine"), "성화")!)).toEqual([3, 4]);
			expect(Array.from(getKeyEmbedding(db, TAG_SCOPE, "기도")!)).toEqual([7, 8]);
			expect(getKeyEmbedding(db, TAG_SCOPE, "성화")).toBeNull();
			expect(
				db.exec(`SELECT embedded_at FROM key_embeddings WHERE scope='${TAG_SCOPE}' AND key='감사'`)[0].values[0][0],
			).toBe(333);
			expect(loadAllKeyEmbeddings(db, lexScope("doctrine"), "m").size).toBe(2);
			expect(loadAllKeyEmbeddings(db, lexScope("없음"), "m").size).toBe(0);

			const t = tables(db);
			expect(t).toContain("note_lexicon_keys");
			expect(t).toContain("key_embeddings");
			expect(t).not.toContain("note_doctrines");
			expect(t).not.toContain("doctrine_embeddings");
			expect(t).not.toContain("tag_embeddings");

			// 무관한 테이블 불변
			expect(count(db, "SELECT COUNT(*) FROM notes")).toBe(2);
			expect(count(db, "SELECT COUNT(*) FROM chunks")).toBe(1);
			expect(count(db, "SELECT COUNT(*) FROM note_tags")).toBe(1);

			// 재실행은 no-op
			expect(runMigrations(db)).toBe(false);
			expect(count(db, "SELECT COUNT(*) FROM note_lexicon_keys")).toBe(3);
		} finally {
			db.close();
		}
	});

	it("마이그레이션 후 노트 삭제가 note_lexicon_keys로 CASCADE된다", () => {
		const db = makeV2();
		try {
			runMigrations(db);
			db.run("DELETE FROM notes WHERE path='a.md'");
			expect(count(db, "SELECT COUNT(*) FROM note_lexicon_keys")).toBe(1);
			expect(count(db, "SELECT COUNT(*) FROM note_lexicon_keys WHERE note_path='b.md'")).toBe(1);
		} finally {
			db.close();
		}
	});

	it("빈 DB(버전 0)는 applySchema만 하고 false", () => {
		const db = new SQL.Database();
		try {
			expect(runMigrations(db)).toBe(false);
			expect(meta(db, "schema_version")).toBe(String(SCHEMA_VERSION));
			expect(tables(db)).toContain("key_embeddings");
			expect(tables(db)).not.toContain("note_doctrines");
		} finally {
			db.close();
		}
	});

	it("지원 버전보다 새 DB는 거부한다", () => {
		const db = new SQL.Database();
		try {
			db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '99');");
			expect(() => runMigrations(db)).toThrow(/newer than supported/);
		} finally {
			db.close();
		}
	});
});
