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
	/** 태그 검색 전용 — 키 가중합(폴더 가중치 곱하기 전). */
	rawScore?: number;
	/** 의미 검색 전용 — 점수 구성 근거(🔬 분석 표시용). hybridSearch만 채운다. */
	trace?: HybridTrace;
	/** dedupe 후 — 같은 노트에서 매칭된 청크 수(대표 포함). dedupeHits가 채운다. */
	noteHitCount?: number;
}

export interface MatchedKey {
	key: string;
	kind: "dExact" | "dSyn" | "dVec" | "tExact" | "tVec";
	/** 이 키가 rawScore에 더한 가중치(3/2/1/1/0.5). */
	weight: number;
	/** 벡터 발견 키(dVec/tVec)의 쿼리 코사인 유사도. 텍스트 매칭 키는 없음. */
	sim?: number;
}

/** 의미 검색 점수 구성 근거 — finalScore를 사람이 재구성할 수 있게 하는 중간값. */
export interface HybridTrace {
	/** RRF 중 BM25 몫(1/(K+순위)). BM25 목록에 없으면 0. */
	rrfBm25: number;
	/** RRF 중 벡터 몫. 벡터 목록에 없으면 0. rrfBm25 + rrfVector = rrfScore. */
	rrfVector: number;
	/** 이 청크에 실제로 등장한 쿼리 토큰(쿼리 순서). */
	matchedTerms: string[];
	/** 볼트 색인에 존재하는(df>0) 쿼리 토큰 수. */
	effectiveTerms: number;
	/** 잡음 필터가 요구한 최소 일치 토큰 수 = min(2, effectiveTerms). */
	requiredTerms: number;
	/** 잡음 필터 통과 사유. "none"은 필터에서 걸러져 결과에 나오지 않는다. */
	passedBy: "terms" | "vector" | "both" | "none";
}

export interface HybridOptions {
	topN?: number;
	candidateK?: number;
	applyWeight?: boolean;
	applyHeadingBoost?: boolean;
	applyOverlapBoost?: boolean;
	/** 의미 전용 히트에 코사인 유사도 보너스(최대 ×1.5, 커버리지와 대칭). 기본 true. */
	applyCosineBoost?: boolean;
	/**
	 * 활성 테마 프로파일의 가중치 해석기(내부 배율 0~1.5). 0을 반환한 노트는
	 * 결과에서 제외된다. 미지정 시 DB notes.weight(= 전 프로파일 최대 scope 값)를
	 * 사용 — 디버그·폴백 전용이며, 프로덕션 호출부는 항상 주입한다.
	 */
	resolveWeight?: (notePath: string) => number;
}

// explain.ts·테스트가 같은 상수를 참조하도록 export (숫자 재타이핑 방지).
export const RRF_K = 60;
export const HEADING_BOOST = 1.2;
export const OVERLAP_FACTOR = 0.5;
/**
 * 벡터 전용 히트의 잡음 문턱. 실측(2026-09-09, text-embedding-3-large 1024d):
 * 관련 쿼리 8개의 벡터 후보 최고 코사인 0.45~0.55, 잡음 쿼리("점심 메뉴") 최고 0.41.
 * 예전 0.6은 어떤 쿼리도 못 넘어 의미 전용 히트가 항상 0건이었다.
 */
export const VECTOR_NOISE_THRESHOLD = 0.45;
/** 이 코사인 이상이면 의미 유사도 보너스 최대(×1.5). 실측 상위 후보가 0.55 안팎. */
export const VECTOR_STRONG_SIM = 0.6;
/**
 * 커버리지 보너스는 쿼리 토큰이 이 개수 이상일 때만. 토큰 1개짜리 쿼리에서는
 * 어휘 히트 전부가 똑같이 ×1.5를 받아 순위 정보는 없고 의미 전용 히트만 밀어내
 * (실측: BM25 30위 1/90×1.5 > 벡터 1위 1/61) 의미 검색이 새 자료를 못 올렸다.
 */
export const MIN_TERMS_FOR_COVERAGE = 2;
const MIN_REQUIRED_MATCH = 2;

/** 코사인 유사도를 잡음 문턱~강한 일치 구간에서 0~1로 정규화. explain.ts와 공유. */
export function cosineMeter(cos: number): number {
	const m =
		(cos - VECTOR_NOISE_THRESHOLD) / (VECTOR_STRONG_SIM - VECTOR_NOISE_THRESHOLD);
	if (!Number.isFinite(m)) return 0;
	return m < 0 ? 0 : m > 1 ? 1 : m;
}
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
	const applyCosineBoost = opts.applyCosineBoost ?? true;

	const uniqueTerms = Array.from(
		new Set(queryTerms.filter((t) => t.length > 0)),
	).slice(0, MAX_QUERY_TERMS);

	// 활성 프로파일에서 0점(제외·미매칭 포함)인 노트는 후보 단계에서 미리 거른다 —
	// 버려질 청크가 후보 K개 슬롯을 차지하면 유효 후보가 모자라 결과가 줄고
	// 테마 차별화가 약해진다(0.11.0). 아래 SQL 게이트·noteWeight<=0 건너뛰기는
	// 이중 안전장치로 유지한다.
	const resolveWeight = opts.resolveWeight;
	const allow = resolveWeight
		? (notePath: string) => resolveWeight(notePath) > 0
		: undefined;
	const bm25Hits = bm25Search(db, uniqueTerms, candidateK, allow);
	const vectorHits = queryEmbedding
		? vectorSearch(db, queryEmbedding, EMBEDDING_MODEL, candidateK, allow)
		: [];

	if (bm25Hits.length === 0 && vectorHits.length === 0) return [];

	interface Entry {
		rrfScore: number;
		rrfBm25: number;
		rrfVector: number;
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
			ex.rrfBm25 = score;
			ex.bm25Rank = rank;
			ex.bm25Score = h.score;
		} else {
			rrfMap.set(h.chunkId, {
				rrfScore: score,
				rrfBm25: score,
				rrfVector: 0,
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
			ex.rrfVector = score;
			ex.vectorRank = rank;
			ex.vectorScore = h.similarity;
		} else {
			rrfMap.set(h.chunkId, {
				rrfScore: score,
				rrfBm25: 0,
				rrfVector: score,
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

	// 청크별 실제 매칭 토큰 목록(🔬 분석 표시용). 길이 = 기존 COUNT(DISTINCT term).
	const matchedMap = new Map<number, string[]>();
	// 볼트에 아예 없는(df=0) 쿼리 토큰 수 — required 계산에서 제외해
	// 미색인 신조어 하나 때문에 유효 결과가 전멸하는 것을 방지.
	let effectiveTerms = uniqueTerms.length;
	if (uniqueTerms.length > 0) {
		const termPlaceholders = uniqueTerms.map(() => "?").join(",");
		const matchRes = db.exec(
			`SELECT DISTINCT chunk_id, term
			 FROM chunk_terms
			 WHERE chunk_id IN (${placeholders})
			   AND term IN (${termPlaceholders})`,
			[...chunkIds, ...uniqueTerms],
		);
		if (matchRes[0]) {
			for (const row of matchRes[0].values) {
				const id = Number(row[0]);
				const list = matchedMap.get(id);
				if (list) list.push(String(row[1]));
				else matchedMap.set(id, [String(row[1])]);
			}
			// 표시 안정성: 쿼리 토큰 순서로 정렬.
			const order = new Map(uniqueTerms.map((t, i) => [t, i]));
			for (const list of matchedMap.values()) {
				list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
			}
		}
		const dfRes = db.exec(
			`SELECT COUNT(DISTINCT term) FROM chunk_terms
			 WHERE term IN (${termPlaceholders})`,
			uniqueTerms,
		);
		effectiveTerms = dfRes[0] ? Number(dfRes[0].values[0][0]) : 0;
	}
	const required = Math.min(MIN_REQUIRED_MATCH, effectiveTerms);

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

			const matchedTerms = matchedMap.get(chunkId) ?? [];
			const matched = matchedTerms.length;
			const coverage =
				uniqueTerms.length > 0 ? matched / uniqueTerms.length : 0;
			const byTerms = matched >= required;
			const byVec =
				entry.vectorScore !== null &&
				entry.vectorScore >= VECTOR_NOISE_THRESHOLD;

			let finalScore = entry.rrfScore;
			if (applyWeight) finalScore *= noteWeight;
			if (applyHeadingBoost && headingMatched) finalScore *= HEADING_BOOST;
			if (
				applyOverlapBoost &&
				uniqueTerms.length >= MIN_TERMS_FOR_COVERAGE
			) {
				finalScore *= 1 + coverage * OVERLAP_FACTOR;
			}
			// 의미 유사도 보너스 — 강한 의미 일치(0.85+)가 약한 어휘 일치보다 위로 오게.
			if (applyCosineBoost && entry.vectorScore !== null) {
				finalScore *= 1 + cosineMeter(entry.vectorScore) * OVERLAP_FACTOR;
			}

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
				trace: {
					rrfBm25: entry.rrfBm25,
					rrfVector: entry.rrfVector,
					matchedTerms,
					effectiveTerms,
					requiredTerms: required,
					passedBy:
						byTerms && byVec
							? "both"
							: byTerms
								? "terms"
								: byVec
									? "vector"
									: "none",
				},
			});
		}
	}

	const filtered = hits.filter((h) => {
		return (
			h.matchedQueryTerms >= required ||
			(h.vectorScore !== null && h.vectorScore >= VECTOR_NOISE_THRESHOLD)
		);
	});
	filtered.sort((a, b) => b.finalScore - a.finalScore);
	return filtered.slice(0, topN);
}
