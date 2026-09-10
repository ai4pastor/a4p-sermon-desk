import type { Database } from "sql.js";

export function floatToBlob(vec: Float32Array): Uint8Array {
	return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function blobToFloat(bytes: Uint8Array): Float32Array {
	const buf = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buf).set(bytes);
	return new Float32Array(buf);
}

export function upsertEmbedding(
	db: Database,
	chunkId: number,
	model: string,
	vec: Float32Array,
): void {
	const stmt = db.prepare(
		"INSERT OR REPLACE INTO embeddings(chunk_id, model, dim, vector) VALUES (?, ?, ?, ?)",
	);
	try {
		stmt.run([chunkId, model, vec.length, floatToBlob(vec)]);
	} finally {
		stmt.free();
	}
}

export function getEmbedding(
	db: Database,
	chunkId: number,
): Float32Array | null {
	const stmt = db.prepare(
		"SELECT vector FROM embeddings WHERE chunk_id = ?",
	);
	try {
		stmt.bind([chunkId]);
		if (!stmt.step()) return null;
		const row = stmt.get() as [Uint8Array];
		return blobToFloat(row[0]);
	} finally {
		stmt.free();
	}
}

export interface MissingChunk {
	id: number;
	text: string;
}

export function getMissingChunks(
	db: Database,
	model: string,
): MissingChunk[] {
	const stmt = db.prepare(
		`SELECT c.id, c.heading, c.text FROM chunks c
		 LEFT JOIN embeddings e ON e.chunk_id = c.id AND e.model = ?
		 WHERE e.chunk_id IS NULL AND length(trim(c.text)) > 0
		 ORDER BY c.id`,
	);
	const out: MissingChunk[] = [];
	try {
		stmt.bind([model]);
		while (stmt.step()) {
			const row = stmt.get() as [number, string | null, string];
			// heading을 임베딩 입력에 포함 — 주제어가 제목에만 있는 청크의 의미 검색 누락 방지.
			out.push({
				id: row[0],
				text: row[1] ? `${row[1]}\n${row[2]}` : row[2],
			});
		}
	} finally {
		stmt.free();
	}
	return out;
}

/** 키 임베딩 범위(key_embeddings.scope) — 볼트 태그는 "tag", 렉시콘은 "lex:<id>". */
export const TAG_SCOPE = "tag";
export function lexScope(lexiconId: string): string {
	return `lex:${lexiconId}`;
}

export function upsertKeyEmbedding(
	db: Database,
	scope: string,
	key: string,
	model: string,
	vec: Float32Array,
	embeddedAt: number,
): void {
	const stmt = db.prepare(
		"INSERT OR REPLACE INTO key_embeddings(scope, key, model, dim, vector, embedded_at) VALUES (?, ?, ?, ?, ?, ?)",
	);
	try {
		stmt.run([scope, key, model, vec.length, floatToBlob(vec), embeddedAt]);
	} finally {
		stmt.free();
	}
}

export function deleteKeyEmbedding(
	db: Database,
	scope: string,
	key: string,
): void {
	const stmt = db.prepare(
		"DELETE FROM key_embeddings WHERE scope = ? AND key = ?",
	);
	try {
		stmt.run([scope, key]);
	} finally {
		stmt.free();
	}
}

export function getKeyEmbedding(
	db: Database,
	scope: string,
	key: string,
): Float32Array | null {
	const stmt = db.prepare(
		"SELECT vector FROM key_embeddings WHERE scope = ? AND key = ?",
	);
	try {
		stmt.bind([scope, key]);
		if (!stmt.step()) return null;
		const row = stmt.get() as [Uint8Array];
		return blobToFloat(row[0]);
	} finally {
		stmt.free();
	}
}

export function getEmbeddedKeys(
	db: Database,
	scope: string,
	model: string,
): Set<string> {
	const stmt = db.prepare(
		"SELECT key FROM key_embeddings WHERE scope = ? AND model = ?",
	);
	const out = new Set<string>();
	try {
		stmt.bind([scope, model]);
		while (stmt.step()) {
			const row = stmt.get() as [string];
			out.add(row[0]);
		}
	} finally {
		stmt.free();
	}
	return out;
}

export function getMaxEmbeddedAt(
	db: Database,
	scope: string,
	model: string,
): number {
	const stmt = db.prepare(
		"SELECT MAX(embedded_at) FROM key_embeddings WHERE scope = ? AND model = ?",
	);
	try {
		stmt.bind([scope, model]);
		if (!stmt.step()) return 0;
		const row = stmt.get() as [number | null];
		return row[0] ?? 0;
	} finally {
		stmt.free();
	}
}

export function loadAllKeyEmbeddings(
	db: Database,
	scope: string,
	model: string,
): Map<string, Float32Array> {
	const stmt = db.prepare(
		"SELECT key, vector FROM key_embeddings WHERE scope = ? AND model = ?",
	);
	const out = new Map<string, Float32Array>();
	try {
		stmt.bind([scope, model]);
		while (stmt.step()) {
			const row = stmt.get() as [string, Uint8Array];
			out.set(row[0], blobToFloat(row[1]));
		}
	} finally {
		stmt.free();
	}
	return out;
}

/**
 * 키 임베딩 캐시 무효화용 지문. COUNT 변화(삭제)와 MAX(embedded_at) 변화(재임베딩)를
 * 모두 잡는다. MAX 단독은 삭제를 놓친다.
 */
export function getKeyEmbeddingFingerprint(
	db: Database,
	scope: string,
	model: string,
): string {
	const stmt = db.prepare(
		"SELECT COUNT(*), MAX(embedded_at) FROM key_embeddings WHERE scope = ? AND model = ?",
	);
	try {
		stmt.bind([scope, model]);
		if (!stmt.step()) return "0:0";
		const row = stmt.get() as [number, number | null];
		return `${row[0]}:${row[1] ?? 0}`;
	} finally {
		stmt.free();
	}
}

/** 주어진 렉시콘들에 매핑된 키(합집합, 정렬). 빈 배열이면 [] — 태그 전용 검색. */
export function getDistinctLexiconKeys(
	db: Database,
	lexiconIds: string[],
): string[] {
	if (lexiconIds.length === 0) return [];
	const placeholders = lexiconIds.map(() => "?").join(",");
	const stmt = db.prepare(
		`SELECT DISTINCT key FROM note_lexicon_keys WHERE lexicon_id IN (${placeholders}) ORDER BY key`,
	);
	const out: string[] = [];
	try {
		stmt.bind(lexiconIds);
		while (stmt.step()) {
			const row = stmt.get() as [string];
			out.push(row[0]);
		}
	} finally {
		stmt.free();
	}
	return out;
}

export function getDistinctTagKeys(db: Database): string[] {
	const stmt = db.prepare(
		`SELECT DISTINCT tag_key FROM note_tags ORDER BY tag_key`,
	);
	const out: string[] = [];
	try {
		while (stmt.step()) {
			const row = stmt.get() as [string];
			out.push(row[0]);
		}
	} finally {
		stmt.free();
	}
	return out;
}
