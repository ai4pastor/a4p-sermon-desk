// dedupeHits/canonicalTitle 회귀 테스트 (RecallView에서 추출한 순수 함수).
import { describe, it, expect } from "vitest";
import type { HybridHit } from "../src/search/hybrid";
import { canonicalTitle, dedupeHits } from "../src/search/dedupe";

function hit(partial: Partial<HybridHit>): HybridHit {
	return {
		chunkId: 1,
		notePath: "n.md",
		noteTitle: "n",
		heading: null,
		preview: "",
		fullText: "",
		categoryId: "internal",
		noteWeight: 1,
		rrfScore: 0,
		finalScore: 1,
		bm25Rank: null,
		vectorRank: null,
		bm25Score: null,
		vectorScore: null,
		headingMatched: false,
		matchedQueryTerms: 0,
		queryTermsTotal: 0,
		...partial,
	};
}

describe("canonicalTitle", () => {
	it("복사본/copy 접미어만 접는다", () => {
		expect(canonicalTitle("설교 복사본")).toBe("설교");
		expect(canonicalTitle("설교 복사본 2")).toBe("설교");
		expect(canonicalTitle("sermon copy")).toBe("sermon");
		expect(canonicalTitle("sermon Copy 3")).toBe("sermon");
	});

	it("정당한 숫자 접미어(시리즈)는 접지 않는다", () => {
		expect(canonicalTitle("시편 23")).toBe("시편 23");
		expect(canonicalTitle("시편 100")).toBe("시편 100");
	});
});

describe("dedupeHits", () => {
	it("같은 노트의 여러 청크 중 최고점만 남긴다", () => {
		const out = dedupeHits([
			hit({ chunkId: 1, notePath: "a.md", noteTitle: "a", finalScore: 1 }),
			hit({ chunkId: 2, notePath: "a.md", noteTitle: "a", finalScore: 3 }),
		]);
		expect(out).toHaveLength(1);
		expect(out[0].chunkId).toBe(2);
	});

	it("복사본 노트는 원본과 하나로 접히고, 시리즈 노트는 별개로 남는다", () => {
		const out = dedupeHits([
			hit({ notePath: "a.md", noteTitle: "설교", finalScore: 2 }),
			hit({ notePath: "b.md", noteTitle: "설교 복사본", finalScore: 1 }),
			hit({ notePath: "c.md", noteTitle: "시편 23", finalScore: 1 }),
			hit({ notePath: "d.md", noteTitle: "시편 100", finalScore: 1 }),
		]);
		const titles = out.map((h) => h.noteTitle).sort();
		expect(titles).toEqual(["설교", "시편 100", "시편 23"]);
	});

	it("동명 노트 tiebreak: noteWeight 우선, 동률이면 finalScore", () => {
		const byWeight = dedupeHits([
			hit({ notePath: "lo.md", noteTitle: "동명", noteWeight: 0.15, finalScore: 9 }),
			hit({ notePath: "hi.md", noteTitle: "동명", noteWeight: 1.5, finalScore: 1 }),
		]);
		expect(byWeight[0].notePath).toBe("hi.md");

		const byScore = dedupeHits([
			hit({ notePath: "a.md", noteTitle: "동명", noteWeight: 1, finalScore: 1 }),
			hit({ notePath: "b.md", noteTitle: "동명", noteWeight: 1, finalScore: 2 }),
		]);
		expect(byScore[0].notePath).toBe("b.md");
	});

	it("결과는 finalScore 내림차순", () => {
		const out = dedupeHits([
			hit({ notePath: "a.md", noteTitle: "a", finalScore: 1 }),
			hit({ notePath: "b.md", noteTitle: "b", finalScore: 3 }),
			hit({ notePath: "c.md", noteTitle: "c", finalScore: 2 }),
		]);
		expect(out.map((h) => h.finalScore)).toEqual([3, 2, 1]);
	});
});
