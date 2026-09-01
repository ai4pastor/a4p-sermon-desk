import type { Database } from "sql.js";
import { vectorSearch } from "./vector";
import { bm25Search } from "./bm25";
import { EMBEDDING_MODEL } from "../embedder/openai";

export interface HybridHit {
	chunkId: number;
	notePath: string;
	noteTitle: string;
	heading: string | null;
	preview: string;
	fullText: string;
	categoryId: string;
	noteWeight: number;
	rrfScore: number;
	finalScore: number;
	bm25Rank: number | null;
	vectorRank: number | null;
	bm25Score: number | null;
	vectorScore: number | null;
	headingMatched: boolean;
	matchedQueryTerms: number;
	queryTermsTotal: number;
	/** 태그 검색 전용 — 이 노트가 추천된 근거 키 목록(카드 칩 표시용). */
	matchedKeys?: MatchedKey[];
}

export interface MatchedKey {
	key: string;
	kind: "dExact" | "dSyn" | "dVec" | "tExact" | "tVec";
}

export interface HybridOptions {
	topN?: number;
	candidateK?: number;
	applyWeight?: boolean;
	applyHeadingBoost?: boolean;
	applyOverlapBoost?: boolean;
	/**
	 * 활성 테마 프로파일의 가중치 해석기(내부 배율 0~1.5). 0을 반환한 노트는
	 * 결과에서 제외된다. 미지정 시 DB notes.weight(= 전 프로파일 최대 scope 값)를
	 * 사용 — 디버그·폴백 전용이며, 프로덕션 호출부는 항상 주입한다.
	 */
	resolveWeight?: (notePath: string) => number;
}

const RRF_K = 60;
const HEADING_BOOST = 1.2;
const OVERLAP_FACTOR = 0.5;
const VECTOR_NOISE_THRESHOLD = 0.6;
const MIN_REQUIRED_MATCH = 2;
const DEFAULT_CANDIDATE_K = 30;
const DEFAULT_TOP_N = 10;
// 노트 전체 선택 같은 초대형 쿼리에서 IN(...) 바인딩 변수 한도 초과를 막는 상한.
// coverage(matched/total)도 이 상한이 적용된 목록 기준으로 일관되게 계산된다.
const MAX_QUERY_TERMS = 500;

export function hybridSearch(
	db: Database,
	queryTerms: string[],
	queryEmbedding: Float32Array | null,
	opts: HybridOptions = {},
): HybridHit[] {
	const topN = opts.topN ?? DEFAULT_TOP_N;
	const candidateK = opts.candidateK ?? DEFAULT_CANDIDATE_K;
	const applyWeight = opts.applyWeight ?? true;
	const applyHeadingBoost = opts.applyHeadingBoost ?? true;
	const applyOverlapBoost = opts.applyOverlapBoost ?? true;

	const uniqueTerms = Array.from(
		new Set(queryTerms.filter((t) => t.length > 0)),
	).slice(0, MAX_QUERY_TERMS);

	const bm25Hits = bm25Search(db, uniqueTerms, candidateK);
	const vectorHits = queryEmbedding
		? vectorSearch(db, queryEmbedding, EMBEDDING_MODEL, candidateK)
		: [];

	if (bm25Hits.length === 0 && vectorHits.length === 0) return [];

	interface Entry {
		rrfScore: number;
		bm25Rank: number | null;
		vectorRank: number | null;
		bm25Score: number | null;
		vectorScore: number | null;
	}
	const rrfMap = new Map<number, Entry>();

	bm25Hits.forEach((h, i) => {
		const rank = i + 1;
		const score = 1 / (RRF_K + rank);
		const ex = rrfMap.get(h.chunkId);
		if (ex) {
			ex.rrfScore += score;
			ex.bm25Rank = rank;
			ex.bm25Score = h.score;
		} else {
			rrfMap.set(h.chunkId, {
				rrfScore: score,
				bm25Rank: rank,
				vectorRank: null,
				bm25Score: h.score,
				vectorScore: null,
			});
		}
	});

	vectorHits.forEach((h) => {
		const rank = h.rank;
		const score = 1 / (RRF_K + rank);
		const ex = rrfMap.get(h.chunkId);
		if (ex) {
			ex.rrfScore += score;
			ex.vectorRank = rank;
			ex.vectorScore = h.similarity;
		} else {
			rrfMap.set(h.chunkId, {
				rrfScore: score,
				bm25Rank: null,
				vectorRank: rank,
				bm25Score: null,
				vectorScore: h.similarity,
			});
		}
	});

	const chunkIds = Array.from(rrfMap.keys());
	if (chunkIds.length === 0) return [];

	const placeholders = chunkIds.map(() => "?").join(",");
	const rows = db.exec(
		`SELECT c.id, c.note_path, c.heading, SUBSTR(c.text, 1, 80), c.text, n.category_id, n.weight
		 FROM chunks c JOIN notes n ON c.note_path = n.path
		 WHERE c.id IN (${placeholders}) AND n.weight > 0`,
		chunkIds,
	);

	const matchedMap = new Map<number, number>();
	// 볼트에 아예 없는(df=0) 쿼리 토큰 수 — required 계산에서 제외해
	// 미색인 신조어 하나 때문에 유효 결과가 전멸하는 것을 방지.
	let effectiveTerms = uniqueTerms.length;
	if (uniqueTerms.length > 0) {
		const termPlaceholders = uniqueTerms.map(() => "?").join(",");
		const matchRes = db.exec(
			`SELECT chunk_id, COUNT(DISTINCT term)
			 FROM chunk_terms
			 WHERE chunk_id IN (${placeholders})
			   AND term IN (${termPlaceholders})
			 GROUP BY chunk_id`,
			[...chunkIds, ...uniqueTerms],
		);
		if (matchRes[0]) {
			for (const row of matchRes[0].values) {
				matchedMap.set(Number(row[0]), Number(row[1]));
			}
		}
		const dfRes = db.exec(
			`SELECT COUNT(DISTINCT term) FROM chunk_terms
			 WHERE term IN (${termPlaceholders})`,
			uniqueTerms,
		);
		effectiveTerms = dfRes[0] ? Number(dfRes[0].values[0][0]) : 0;
	}

	const hits: HybridHit[] = [];
	if (rows[0]) {
		for (const r of rows[0].values) {
			const chunkId = Number(r[0]);
			const notePath = String(r[1]);
			const heading = r[2] === null ? null : String(r[2]);
			const preview = String(r[3] ?? "");
			const fullText = String(r[4] ?? "");
			const categoryId = String(r[5]);
			const noteWeight = opts.resolveWeight
				? opts.resolveWeight(notePath)
				: Number(r[6]);
			// 활성 프로파일에서 0점(또는 미매칭/제외)인 노트는 제외.
			if (noteWeight <= 0) continue;
			const entry = rrfMap.get(chunkId);
			if (!entry) continue;

			// 토큰은 소문자화되므로 heading도 소문자로 비교. 1글자 토큰은
			// 부분문자열 과매칭("물"⊂"물음")이 잦아 부스트에서 제외.
			const headingLower = heading ? heading.toLowerCase() : null;
			const headingMatched = headingLower
				? queryTerms.some(
						(t) => t.length >= 2 && headingLower.includes(t),
					)
				: false;

			const matched = matchedMap.get(chunkId) ?? 0;
			const coverage =
				uniqueTerms.length > 0 ? matched / uniqueTerms.length : 0;

			let finalScore = entry.rrfScore;
			if (applyWeight) finalScore *= noteWeight;
			if (applyHeadingBoost && headingMatched) finalScore *= HEADING_BOOST;
			if (applyOverlapBoost) finalScore *= 1 + coverage * OVERLAP_FACTOR;

			const noteTitle =
				notePath.split("/").pop()?.replace(/\.md$/, "") ?? notePath;

			hits.push({
				chunkId,
				notePath,
				noteTitle,
				heading,
				preview,
				fullText,
				categoryId,
				noteWeight,
				rrfScore: entry.rrfScore,
				finalScore,
				bm25Rank: entry.bm25Rank,
				vectorRank: entry.vectorRank,
				bm25Score: entry.bm25Score,
				vectorScore: entry.vectorScore,
				headingMatched,
				matchedQueryTerms: matched,
				queryTermsTotal: uniqueTerms.length,
			});
		}
	}

	const filtered = hits.filter((h) => {
		const required = Math.min(MIN_REQUIRED_MATCH, effectiveTerms);
		return (
			h.matchedQueryTerms >= required ||
			(h.vectorScore !== null && h.vectorScore >= VECTOR_NOISE_THRESHOLD)
		);
	});
	filtered.sort((a, b) => b.finalScore - a.finalScore);
	return filtered.slice(0, topN);
}
