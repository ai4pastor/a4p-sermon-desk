// explainHit — 점수 구성 분해의 자기 일관성(세그먼트 합 = 1, product = finalScore).
import { describe, it, expect } from "vitest";
import {
	explainHit,
	KIND_LABEL_KO,
	PASS_LABEL_KO,
} from "../src/search/explain";
import {
	HEADING_BOOST,
	MIN_TERMS_FOR_COVERAGE,
	RRF_K,
	VECTOR_NOISE_THRESHOLD,
	VECTOR_STRONG_SIM,
	cosineMeter,
	type HybridHit,
	type HybridTrace,
} from "../src/search/hybrid";

const MID_SIM = (VECTOR_NOISE_THRESHOLD + VECTOR_STRONG_SIM) / 2;

function rrf(rank: number): number {
	return 1 / (RRF_K + rank);
}

function baseHit(over: Partial<HybridHit> = {}): HybridHit {
	return {
		chunkId: 1,
		notePath: "a/b.md",
		noteTitle: "b",
		heading: null,
		preview: "",
		fullText: "",
		categoryId: "internal",
		noteWeight: 1,
		rrfScore: 0,
		finalScore: 0,
		bm25Rank: null,
		vectorRank: null,
		bm25Score: null,
		vectorScore: null,
		headingMatched: false,
		matchedQueryTerms: 0,
		queryTermsTotal: 0,
		...over,
	};
}

/** hybrid.ts 공식대로 finalScore·trace를 채운 히트를 만든다. */
function hybridHit(spec: {
	bm25Rank: number | null;
	vectorRank: number | null;
	vectorScore?: number;
	weight?: number;
	heading?: boolean;
	matchedTerms?: string[];
	total?: number;
	effectiveTerms?: number;
}): HybridHit {
	const rrfBm25 = spec.bm25Rank ? rrf(spec.bm25Rank) : 0;
	const rrfVector = spec.vectorRank ? rrf(spec.vectorRank) : 0;
	const rrfScore = rrfBm25 + rrfVector;
	const weight = spec.weight ?? 1;
	const matched = spec.matchedTerms ?? [];
	const total = spec.total ?? matched.length;
	const effective = spec.effectiveTerms ?? total;
	const required = Math.min(2, effective);
	const coverage = total > 0 ? matched.length / total : 0;
	const vs = spec.vectorRank ? (spec.vectorScore ?? 0.7) : null;
	const finalScore =
		rrfScore *
		weight *
		(spec.heading ? HEADING_BOOST : 1) *
		(total >= MIN_TERMS_FOR_COVERAGE ? 1 + coverage * 0.5 : 1) *
		(vs === null ? 1 : 1 + cosineMeter(vs) * 0.5);
	const byTerms = matched.length >= required;
	const byVec = (spec.vectorScore ?? 0) >= VECTOR_NOISE_THRESHOLD;
	const trace: HybridTrace = {
		rrfBm25,
		rrfVector,
		matchedTerms: matched,
		effectiveTerms: effective,
		requiredTerms: required,
		passedBy:
			byTerms && byVec
				? "both"
				: byTerms
					? "terms"
					: byVec
						? "vector"
						: "none",
	};
	return baseHit({
		rrfScore,
		finalScore,
		noteWeight: weight,
		bm25Rank: spec.bm25Rank,
		vectorRank: spec.vectorRank,
		bm25Score: spec.bm25Rank ? 4.2 : null,
		vectorScore: vs,
		headingMatched: !!spec.heading,
		matchedQueryTerms: matched.length,
		queryTermsTotal: total,
		trace,
	});
}

describe("explainHit — 의미 검색", () => {
	it("양쪽 소스: 세그먼트 합 1, RRF 분해 합 = rrfScore, product = finalScore", () => {
		const h = hybridHit({
			bm25Rank: 6,
			vectorRank: 3,
			vectorScore: 0.71,
			weight: 1.05,
			heading: true,
			matchedTerms: ["창조", "빛", "말씀"],
			total: 6,
		});
		const ex = explainHit(h, h.finalScore * 2);
		expect(ex.mode).toBe("hybrid");
		expect(ex.relative).toBeCloseTo(0.5, 12);
		expect(ex.primaryShare + ex.secondaryShare).toBeCloseTo(1, 12);
		expect(ex.primaryShare).toBeCloseTo(rrf(6) / (rrf(6) + rrf(3)), 12);
		expect(ex.base).toBeCloseTo(h.rrfScore, 12);
		expect(ex.product).toBeCloseTo(h.finalScore, 12);
		expect(ex.multipliers.heading).toBe(HEADING_BOOST);
		expect(ex.multipliers.coverage).toBeCloseTo(1 + 0.5 * 0.5, 12);
		expect(ex.coverageApplied).toBe(true);
		expect(ex.multipliers.cosine).toBeCloseTo(1 + cosineMeter(0.71) * 0.5, 12);
		expect(ex.hybrid?.matchedTerms).toEqual(["창조", "빛", "말씀"]);
		expect(ex.hybrid?.passedBy).toBe("both");
		expect(ex.hybrid?.hasTrace).toBe(true);
	});

	it("벡터 전용: BM25 몫 0, 검색어 0개, vector로 통과, 코사인 미터 정규화", () => {
		const h = hybridHit({
			bm25Rank: null,
			vectorRank: 1,
			vectorScore: MID_SIM,
			total: 3,
			matchedTerms: [],
		});
		const ex = explainHit(h, h.finalScore);
		expect(ex.relative).toBe(1);
		expect(ex.primaryShare).toBe(0);
		expect(ex.secondaryShare).toBe(1);
		expect(ex.hybrid?.passedBy).toBe("vector");
		expect(ex.hybrid?.cosineMeter).toBeCloseTo(0.5, 12); // 문턱~강한 일치의 중간
		expect(ex.multipliers.cosine).toBeCloseTo(1.25, 12);
		expect(ex.product).toBeCloseTo(h.finalScore, 12);
	});

	it("검색어 1개: 커버리지 보너스 미적용(×1.0, coverageApplied=false), product 일치", () => {
		const h = hybridHit({
			bm25Rank: 1,
			vectorRank: null,
			matchedTerms: ["칭의"],
			total: 1,
		});
		const ex = explainHit(h, h.finalScore);
		expect(ex.coverageApplied).toBe(false);
		expect(ex.multipliers.coverage).toBe(1);
		expect(ex.multipliers.cosine).toBe(1);
		expect(ex.product).toBeCloseTo(h.finalScore, 12);
	});

	it("코사인 미터 경계: 문턱 → 0, 강한 일치 이상 → 1", () => {
		const lo = hybridHit({
			bm25Rank: null,
			vectorRank: 2,
			vectorScore: VECTOR_NOISE_THRESHOLD,
		});
		const hi = hybridHit({ bm25Rank: null, vectorRank: 2, vectorScore: 1.0 });
		expect(explainHit(lo, 1).hybrid?.cosineMeter).toBeCloseTo(0, 12);
		expect(explainHit(hi, 1).hybrid?.cosineMeter).toBeCloseTo(1, 12);
	});

	it("BM25 전용: 벡터 몫 0, 코사인 미터 null, terms로 통과", () => {
		const h = hybridHit({
			bm25Rank: 2,
			vectorRank: null,
			matchedTerms: ["은혜", "믿음"],
			total: 2,
		});
		const ex = explainHit(h, h.finalScore);
		expect(ex.primaryShare).toBe(1);
		expect(ex.secondaryShare).toBe(0);
		expect(ex.hybrid?.cosineMeter).toBeNull();
		expect(ex.hybrid?.passedBy).toBe("terms");
		expect(ex.product).toBeCloseTo(h.finalScore, 12);
	});

	it("topScore 0 → relative 0, finalScore > topScore(핀 카드) → 1로 clamp", () => {
		const h = hybridHit({ bm25Rank: 1, vectorRank: 1, matchedTerms: ["a"], total: 1 });
		expect(explainHit(h, 0).relative).toBe(0);
		expect(explainHit(h, h.finalScore / 3).relative).toBe(1);
	});

	it("trace 없는 히트도 throw 없이 분해(전체를 primary로, hasTrace=false)", () => {
		const h = baseHit({
			rrfScore: rrf(1),
			finalScore: rrf(1),
			bm25Rank: 1,
			bm25Score: 1,
			matchedQueryTerms: 1,
			queryTermsTotal: 1,
		});
		// coverage 1 → ×1.5 이므로 product는 finalScore와 다를 수 있음 — 여기선 상수 검사만.
		const ex = explainHit(h, rrf(1));
		expect(ex.hybrid?.hasTrace).toBe(false);
		expect(ex.primaryShare).toBe(1);
		expect(ex.secondaryShare).toBe(0);
		expect(ex.hybrid?.matchedTerms).toEqual([]);
	});
});

describe("explainHit — 태그 검색", () => {
	it("교리/태그 가중치 합으로 세그먼트를 나누고 product = rawScore × weight", () => {
		const h = baseHit({
			noteWeight: 1.2,
			rawScore: 4.5,
			finalScore: 4.5 * 1.2,
			matchedQueryTerms: 3,
			queryTermsTotal: 4,
			matchedKeys: [
				{ key: "칭의", kind: "dExact", weight: 3 },
				{ key: "감사", kind: "tExact", weight: 1 },
				{ key: "거룩한삶", kind: "tVec", weight: 0.5, sim: 0.77 },
			],
		});
		const ex = explainHit(h, h.finalScore);
		expect(ex.mode).toBe("tag");
		expect(ex.base).toBe(4.5);
		expect(ex.tag?.doctrineSum).toBe(3);
		expect(ex.tag?.tagSum).toBe(1.5);
		expect(ex.primaryShare).toBeCloseTo(3 / 4.5, 12);
		expect(ex.secondaryShare).toBeCloseTo(1.5 / 4.5, 12);
		expect(ex.product).toBeCloseTo(h.finalScore, 12);
		expect(ex.multipliers).toEqual({
			weight: 1.2,
			heading: 1,
			coverage: 1,
			cosine: 1,
		});
		expect(ex.coverageApplied).toBe(false);
		expect(ex.tag?.keys[2].sim).toBe(0.77);
	});

	it("라벨 상수가 모든 종류·통과 사유를 덮는다", () => {
		for (const k of ["dExact", "dSyn", "dVec", "tExact", "tVec"] as const) {
			expect(KIND_LABEL_KO[k]).toBeTruthy();
		}
		for (const p of ["terms", "vector", "both", "none"] as const) {
			expect(PASS_LABEL_KO[p]).toBeTruthy();
		}
	});
});
