import type { Database } from "sql.js";
import { blobToFloat } from "../db/embeddings";

export type VectorMatch = {
	chunkId: number;
	similarity: number;
	rank: number;
};

const DEFAULT_TOP_K = 30;

interface CachedEmbedding {
	chunkId: number;
	/** 활성 프로파일 0점 노트를 후보 단계에서 거르는 술어용. */
	notePath: string;
	vec: Float32Array;
	norm: number;
}

// 청크 임베딩 메모리 캐시 — 검색마다 전량 blob 읽기·변환을 피한다.
// chunks/embeddings는 UPDATE 없이 delete+insert(AUTOINCREMENT)이므로
// COUNT+MAX(rowid) 지문으로 모든 변경이 감지된다.
let embCache: {
	model: string;
	fp: string;
	entries: CachedEmbedding[];
} | null = null;

function embeddingsFingerprint(db: Database, model: string): string {
	const r = db.exec(
		"SELECT COUNT(*), MAX(rowid) FROM embeddings WHERE model = ?",
		[model],
	);
	const row = r[0]?.values[0];
	return row ? `${row[0]}:${row[1]}` : "0:null";
}

function loadEmbeddings(db: Database, model: string): CachedEmbedding[] {
	// chunks JOIN으로 노트 경로를 함께 적재 — chunks는 delete+insert라 경로가
	// 제자리에서 바뀌지 않으므로 기존 COUNT+MAX(rowid) 지문으로 충분하다.
	const stmt = db.prepare(
		`SELECT e.chunk_id, e.vector, c.note_path
		 FROM embeddings e JOIN chunks c ON c.id = e.chunk_id
		 WHERE e.model = ?`,
	);
	const entries: CachedEmbedding[] = [];
	try {
		stmt.bind([model]);
		while (stmt.step()) {
			const row = stmt.get() as [number, Uint8Array, string];
			const vec = blobToFloat(row[1]);
			entries.push({
				chunkId: row[0],
				notePath: String(row[2]),
				vec,
				norm: norm(vec),
			});
		}
	} finally {
		stmt.free();
	}
	return entries;
}

/**
 * @param allow 노트 경로 술어 — false를 반환한 노트의 청크는 topK 자르기 전에
 *   제외된다(활성 테마 프로파일 0점 노트가 후보 슬롯을 소모하지 않도록).
 */
export function vectorSearch(
	db: Database,
	queryVector: Float32Array,
	model: string,
	topK = DEFAULT_TOP_K,
	allow?: (notePath: string) => boolean,
): VectorMatch[] {
	const queryNorm = norm(queryVector);
	if (queryNorm === 0) return [];

	const fp = embeddingsFingerprint(db, model);
	if (!embCache || embCache.model !== model || embCache.fp !== fp) {
		embCache = { model, fp, entries: loadEmbeddings(db, model) };
	}

	const scored: { chunkId: number; similarity: number }[] = [];
	for (const e of embCache.entries) {
		if (allow && !allow(e.notePath)) continue;
		if (e.vec.length !== queryVector.length) continue;
		if (e.norm === 0) continue;
		let dot = 0;
		for (let i = 0; i < queryVector.length; i++) {
			dot += queryVector[i] * e.vec[i];
		}
		scored.push({
			chunkId: e.chunkId,
			similarity: dot / (queryNorm * e.norm),
		});
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
 * 텍스트 매칭이 놓친 의미 유사 키를 발견: 코사인 ≥ threshold 인 키를 topK개,
 * 유사도 값과 함께(🔬 분석 표시용).
 */
export function topVectorKeyHits(
	queryVec: Float32Array,
	keyEmb: Map<string, Float32Array>,
	allow: Set<string>,
	exclude: Set<string>,
	threshold: number,
	topK: number,
): { key: string; sim: number }[] {
	const sims = topVectorSims(queryVec, keyEmb, allow, exclude);
	const out: { key: string; sim: number }[] = [];
	for (const s of sims) {
		if (s.sim < threshold) break;
		out.push(s);
		if (out.length >= topK) break;
	}
	return out;
}

/** topVectorKeyHits의 키만 — 기존 호출부·실측 하니스 호환. */
export function topVectorKeys(
	queryVec: Float32Array,
	keyEmb: Map<string, Float32Array>,
	allow: Set<string>,
	exclude: Set<string>,
	threshold: number,
	topK: number,
): string[] {
	return topVectorKeyHits(
		queryVec,
		keyEmb,
		allow,
		exclude,
		threshold,
		topK,
	).map((s) => s.key);
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
