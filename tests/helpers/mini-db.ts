// 랭킹 회귀 테스트용 인메모리 미니 DB 헬퍼.
//
// ⚠️ 캐시 오염 방지가 핵심 설계다: vector.ts(embCache)·bm25.ts(statsCache)는
// 모듈 전역 캐시를 COUNT+MAX(id/rowid) 지문으로만 무효화한다. 프레시 인메모리
// DB끼리 지문이 우연히 일치하면 이전 테스트의 캐시를 재사용하므로, DB마다
// 청크 id를 고유 오프셋(base)에서 시작시켜 지문을 항상 유일하게 만든다.
// (embeddings.chunk_id는 INTEGER PRIMARY KEY = rowid 별칭이라 청크 id 오프셋이
//  두 캐시 지문을 모두 유일하게 만든다.)
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import path from "node:path";
import { applySchema } from "../../src/db/schema";
import { floatToBlob } from "../../src/db/embeddings";
import { EMBEDDING_MODEL } from "../../src/embedder/openai";

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
	if (!sqlPromise) {
		sqlPromise = initSqlJs({
			locateFile: (f: string) =>
				path.resolve(process.cwd(), "node_modules/sql.js/dist", f),
		});
	}
	return sqlPromise;
}

let dbCounter = 0;

export interface ChunkSpec {
	heading?: string | null;
	text: string;
	/** BM25 역색인 토큰. 중복 허용(중복 수 = tf). */
	terms?: string[];
	/** 청크 임베딩(소차원 가짜 벡터). 쿼리 벡터와 같은 차원이어야 한다. */
	vec?: number[];
}

export interface MiniDb {
	db: Database;
	addNote(
		notePath: string,
		opts?: { weight?: number; group?: "internal" | "external" },
	): void;
	/** 청크 추가 — 명시적 id(base+seq)를 부여하고 id를 반환. */
	addChunk(notePath: string, spec: ChunkSpec): number;
	addDoctrine(notePath: string, key: string): void;
	addTag(notePath: string, key: string): void;
	close(): void;
}

export async function makeMiniDb(): Promise<MiniDb> {
	const SQL = await getSql();
	const db = new SQL.Database();
	applySchema(db);
	dbCounter += 1;
	const base = dbCounter * 10_000;
	let seq = 0;

	return {
		db,
		addNote(notePath, opts = {}) {
			db.run(
				"INSERT INTO notes(path, mtime, size, category_id, weight, indexed_at) VALUES (?, 0, 0, ?, ?, 0)",
				[notePath, opts.group ?? "internal", opts.weight ?? 1.0],
			);
		},
		addChunk(notePath, spec) {
			seq += 1;
			const id = base + seq;
			db.run(
				"INSERT INTO chunks(id, note_path, ord, heading, text) VALUES (?, ?, ?, ?, ?)",
				[id, notePath, seq, spec.heading ?? null, spec.text],
			);
			for (const t of spec.terms ?? []) {
				db.run(
					"INSERT INTO chunk_terms(chunk_id, term) VALUES (?, ?)",
					[id, t],
				);
			}
			if (spec.vec) {
				const v = Float32Array.from(spec.vec);
				db.run(
					"INSERT INTO embeddings(chunk_id, model, dim, vector) VALUES (?, ?, ?, ?)",
					[id, EMBEDDING_MODEL, v.length, floatToBlob(v)],
				);
			}
			return id;
		},
		addDoctrine(notePath, key) {
			db.run(
				"INSERT OR IGNORE INTO note_doctrines(note_path, doctrine_key) VALUES (?, ?)",
				[notePath, key],
			);
		},
		addTag(notePath, key) {
			db.run(
				"INSERT OR IGNORE INTO note_tags(note_path, tag_key) VALUES (?, ?)",
				[notePath, key],
			);
		},
		close() {
			db.close();
		},
	};
}

export function vecOf(...nums: number[]): Float32Array {
	return Float32Array.from(nums);
}
