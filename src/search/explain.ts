// 검색 결과 한 건의 점수 구성을 사람이 읽을 수 있는 형태로 분해한다(🔬 분석).
// 순수 함수 — obsidian·DB 의존 없음. 공식은 hybrid.ts/tag.ts와 같은 상수를 참조한다.
//
// 정직한 분해 원칙: 막대 세그먼트는 "더해지는" 성분(RRF의 BM25 몫·벡터 몫,
// 태그 모드의 키워드(어휘 사전)·태그 가중치 합)만 나눈다. 곱해지는 인자(폴더 가중치·제목
// 일치·포함률)는 세그먼트가 아니라 배율 칩으로 따로 보인다.
import {
	HEADING_BOOST,
	MIN_TERMS_FOR_COVERAGE,
	OVERLAP_FACTOR,
	cosineMeter,
	type HybridHit,
	type HybridTrace,
	type MatchedKey,
} from "./hybrid";

export type NoisePass = HybridTrace["passedBy"];

export interface HitExplanation {
	mode: "hybrid" | "tag";
	/** finalScore / topScore, 0~1로 clamp. topScore≤0이면 0. */
	relative: number;
	/** 세그먼트 비율 — hybrid: BM25/벡터, tag: 키워드/태그. 합 = 1 (base 0이면 둘 다 0). */
	primaryShare: number;
	secondaryShare: number;
	/** hybrid: rrfScore, tag: rawScore(키 가중합). */
	base: number;
	/** 곱셈 인자. tag 모드는 heading·coverage·cosine = 1. */
	multipliers: {
		weight: number;
		heading: number;
		coverage: number;
		cosine: number;
	};
	/** hybrid: 커버리지 보너스가 적용됐는지(쿼리 토큰 ≥ 2). tag: false. */
	coverageApplied: boolean;
	/** base × Π multipliers — finalScore와 일치해야 한다(자기 검증용). */
	product: number;
	hybrid?: {
		bm25Rank: number | null;
		bm25Score: number | null;
		vectorRank: number | null;
		vectorScore: number | null;
		/** 유사도를 잡음 문턱~강한 일치(VECTOR_NOISE_THRESHOLD~VECTOR_STRONG_SIM) 구간에서 0~1로 정규화. 벡터 없으면 null. */
		cosineMeter: number | null;
		matchedTerms: string[];
		matched: number;
		total: number;
		effectiveTerms: number;
		requiredTerms: number;
		passedBy: NoisePass;
		/** trace가 없는 히트(구 경로) — 분해 불가, 합계만 표시. */
		hasTrace: boolean;
	};
	tag?: {
		rawScore: number;
		keys: MatchedKey[];
		doctrineSum: number;
		tagSum: number;
	};
}

export const KIND_LABEL_KO: Record<MatchedKey["kind"], string> = {
	dExact: "키워드 정확 일치",
	dSyn: "키워드 동의어",
	dVec: "키워드 의미 유사",
	tExact: "태그 정확 일치",
	tVec: "태그 의미 유사",
};

export const PASS_LABEL_KO: Record<NoisePass, string> = {
	terms: "검색어 일치로 통과",
	vector: "검색어는 부족하지만 의미 유사도로 통과",
	both: "검색어 일치 + 의미 유사도 모두 충족",
	none: "필터 미통과",
};

function clamp01(x: number): number {
	if (!Number.isFinite(x)) return 0;
	return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function explainHit(hit: HybridHit, topScore: number): HitExplanation {
	const relative = topScore > 0 ? clamp01(hit.finalScore / topScore) : 0;
	if (hit.rawScore !== undefined) return explainTag(hit, relative);
	return explainHybrid(hit, relative);
}

function explainHybrid(hit: HybridHit, relative: number): HitExplanation {
	const t = hit.trace;
	const base = hit.rrfScore;
	const rrfBm25 = t ? t.rrfBm25 : 0;
	const rrfVector = t ? t.rrfVector : 0;
	const split = rrfBm25 + rrfVector;
	// trace가 없으면 분해 불가 → 전체를 primary로.
	const primaryShare = t ? (split > 0 ? rrfBm25 / split : 0) : base > 0 ? 1 : 0;
	const secondaryShare = t ? (split > 0 ? rrfVector / split : 0) : 0;
	const total = hit.queryTermsTotal;
	const coverage = total > 0 ? hit.matchedQueryTerms / total : 0;
	const coverageApplied = total >= MIN_TERMS_FOR_COVERAGE;
	const meter = hit.vectorScore === null ? null : cosineMeter(hit.vectorScore);
	const multipliers = {
		weight: hit.noteWeight,
		heading: hit.headingMatched ? HEADING_BOOST : 1,
		coverage: coverageApplied ? 1 + coverage * OVERLAP_FACTOR : 1,
		cosine: meter === null ? 1 : 1 + meter * OVERLAP_FACTOR,
	};
	return {
		mode: "hybrid",
		relative,
		primaryShare,
		secondaryShare,
		base,
		multipliers,
		coverageApplied,
		product:
			base *
			multipliers.weight *
			multipliers.heading *
			multipliers.coverage *
			multipliers.cosine,
		hybrid: {
			bm25Rank: hit.bm25Rank,
			bm25Score: hit.bm25Score,
			vectorRank: hit.vectorRank,
			vectorScore: hit.vectorScore,
			cosineMeter: meter,
			matchedTerms: t ? t.matchedTerms : [],
			matched: hit.matchedQueryTerms,
			total,
			effectiveTerms: t ? t.effectiveTerms : total,
			requiredTerms: t ? t.requiredTerms : 0,
			passedBy: t ? t.passedBy : "none",
			hasTrace: !!t,
		},
	};
}

function explainTag(hit: HybridHit, relative: number): HitExplanation {
	const keys = hit.matchedKeys ?? [];
	const rawScore = hit.rawScore ?? 0;
	let doctrineSum = 0;
	let tagSum = 0;
	for (const k of keys) {
		if (k.kind === "tExact" || k.kind === "tVec") tagSum += k.weight;
		else doctrineSum += k.weight;
	}
	const split = doctrineSum + tagSum;
	const multipliers = {
		weight: hit.noteWeight,
		heading: 1,
		coverage: 1,
		cosine: 1,
	};
	return {
		mode: "tag",
		relative,
		primaryShare: split > 0 ? doctrineSum / split : 0,
		secondaryShare: split > 0 ? tagSum / split : 0,
		base: rawScore,
		multipliers,
		coverageApplied: false,
		product: rawScore * multipliers.weight,
		tag: { rawScore, keys, doctrineSum, tagSum },
	};
}
