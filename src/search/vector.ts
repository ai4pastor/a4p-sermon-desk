import type { Database } from "sql.js";
import { blobToFloat } from "../db/embeddings";

export type VectorMatch = {
	chunkId: number;
	similarity: number;
	rank: number;
};

const DEFAULT_TOP_K = 30;

export function vectorSearch(
	db: Database,
	queryVector: Float32Array,
	model: string,
	topK = DEFAULT_TOP_K,
): VectorMatch[] {
	const queryNorm = norm(queryVector);
	if (queryNorm === 0) return [];

	const stmt = db.prepare(
		"SELECT chunk_id, vector FROM embeddings WHERE model = ?",
	);
	const scored: { chunkId: number; similarity: number }[] = [];
	try {
		stmt.bind([model]);
		while (stmt.step()) {
			const row = stmt.get() as [number, Uint8Array];
			const vec = blobToFloat(row[1]);
			if (vec.length !== queryVector.length) continue;
			const sim = cosine(queryVector, queryNorm, vec);
			scored.push({ chunkId: row[0], similarity: sim });
		}
	} finally {
		stmt.free();
	}

	scored.sort((a, b) => b.similarity - a.similarity);
	return scored.slice(0, topK).map((m, i) => ({
		chunkId: m.chunkId,
		similarity: m.similarity,
		rank: i + 1,
	}));
}

/**
 * allow(현재 lexicon)에 있고 exclude(이미 텍스트 매칭)에 없는 키의
 * 쿼리 임베딩 코사인을 전부 계산해 내림차순 정렬해 반환(threshold 미적용).
 * 진단/튜닝과 topVectorKeys가 공유하는 기반.
 */
function topVectorSims(
	queryVec: Float32Array,
	keyEmb: Map<string, Float32Array>,
	allow: Set<string>,
	exclude: Set<string>,
): { key: string; sim: number }[] {
	const qNorm = norm(queryVec);
	if (qNorm === 0) return [];
	const scored: { key: string; sim: number }[] = [];
	for (const [key, vec] of keyEmb) {
		if (!allow.has(key)) continue;
		if (exclude.has(key)) continue;
		if (vec.length !== queryVec.length) continue;
		const sim = cosine(queryVec, qNorm, vec);
		if (!Number.isFinite(sim)) continue;
		scored.push({ key, sim });
	}
	scored.sort((a, b) => b.sim - a.sim);
	return scored;
}

/**
 * 텍스트 매칭이 놓친 의미 유사 키를 발견: 코사인 ≥ threshold 인 키를 topK개.
 */
export function topVectorKeys(
	queryVec: Float32Array,
	keyEmb: Map<string, Float32Array>,
	allow: Set<string>,
	exclude: Set<string>,
	threshold: number,
	topK: number,
): string[] {
	const sims = topVectorSims(queryVec, keyEmb, allow, exclude);
	const out: string[] = [];
	for (const s of sims) {
		if (s.sim < threshold) break;
		out.push(s.key);
		if (out.length >= topK) break;
	}
	return out;
}

function norm(v: Float32Array): number {
	let s = 0;
	for (let i = 0; i < v.length; i++) s += v[i] * v[i];
	return Math.sqrt(s);
}

function cosine(q: Float32Array, qNorm: number, v: Float32Array): number {
	let dot = 0;
	let vSq = 0;
	for (let i = 0; i < q.length; i++) {
		dot += q[i] * v[i];
		vSq += v[i] * v[i];
	}
	const vNorm = Math.sqrt(vSq);
	if (vNorm === 0) return 0;
	return dot / (qNorm * vNorm);
}
