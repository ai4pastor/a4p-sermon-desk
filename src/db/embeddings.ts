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
		`SELECT c.id, c.text FROM chunks c
		 LEFT JOIN embeddings e ON e.chunk_id = c.id AND e.model = ?
		 WHERE e.chunk_id IS NULL AND length(trim(c.text)) > 0
		 ORDER BY c.id`,
	);
	const out: MissingChunk[] = [];
	try {
		stmt.bind([model]);
		while (stmt.step()) {
			const row = stmt.get() as [number, string];
			out.push({ id: row[0], text: row[1] });
		}
	} finally {
		stmt.free();
	}
	return out;
}

export type KeyEmbeddingTable = "doctrine_embeddings" | "tag_embeddings";

export function upsertKeyEmbedding(
	db: Database,
	table: KeyEmbeddingTable,
	key: string,
	model: string,
	vec: Float32Array,
	embeddedAt: number,
): void {
	const stmt = db.prepare(
		`INSERT OR REPLACE INTO ${table}(key, model, dim, vector, embedded_at) VALUES (?, ?, ?, ?, ?)`,
	);
	try {
		stmt.run([key, model, vec.length, floatToBlob(vec), embeddedAt]);
	} finally {
		stmt.free();
	}
}

export function deleteKeyEmbedding(
	db: Database,
	table: KeyEmbeddingTable,
	key: string,
): void {
	const stmt = db.prepare(`DELETE FROM ${table} WHERE key = ?`);
	try {
		stmt.run([key]);
	} finally {
		stmt.free();
	}
}

export function getKeyEmbedding(
	db: Database,
	table: KeyEmbeddingTable,
	key: string,
): Float32Array | null {
	const stmt = db.prepare(`SELECT vector FROM ${table} WHERE key = ?`);
	try {
		stmt.bind([key]);
		if (!stmt.step()) return null;
		const row = stmt.get() as [Uint8Array];
		return blobToFloat(row[0]);
	} finally {
		stmt.free();
	}
}

export function getEmbeddedKeys(
	db: Database,
	table: KeyEmbeddingTable,
	model: string,
): Set<string> {
	const stmt = db.prepare(`SELECT key FROM ${table} WHERE model = ?`);
	const out = new Set<string>();
	try {
		stmt.bind([model]);
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
	table: KeyEmbeddingTable,
	model: string,
): number {
	const stmt = db.prepare(
		`SELECT MAX(embedded_at) FROM ${table} WHERE model = ?`,
	);
	try {
		stmt.bind([model]);
		if (!stmt.step()) return 0;
		const row = stmt.get() as [number | null];
		return row[0] ?? 0;
	} finally {
		stmt.free();
	}
}

export function loadAllKeyEmbeddings(
	db: Database,
	table: KeyEmbeddingTable,
	model: string,
): Map<string, Float32Array> {
	const stmt = db.prepare(`SELECT key, vector FROM ${table} WHERE model = ?`);
	const out = new Map<string, Float32Array>();
	try {
		stmt.bind([model]);
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
	table: KeyEmbeddingTable,
	model: string,
): string {
	const stmt = db.prepare(
		`SELECT COUNT(*), MAX(embedded_at) FROM ${table} WHERE model = ?`,
	);
	try {
		stmt.bind([model]);
		if (!stmt.step()) return "0:0";
		const row = stmt.get() as [number, number | null];
		return `${row[0]}:${row[1] ?? 0}`;
	} finally {
		stmt.free();
	}
}

export function getDistinctDoctrineKeys(db: Database): string[] {
	const stmt = db.prepare(
		`SELECT DISTINCT doctrine_key FROM note_doctrines ORDER BY doctrine_key`,
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
