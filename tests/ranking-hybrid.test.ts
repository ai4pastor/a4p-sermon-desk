// hybridSearch 랭킹 불변식 회귀 테스트 — 인메모리 미니 DB.
// 점수 스냅샷이 아니라 비율·순서·포함/제외만 assert한다(시그니처 변화에 강하게).
import { describe, it, expect } from "vitest";
import { hybridSearch } from "../src/search/hybrid";
import { makeMiniDb, vecOf } from "./helpers/mini-db";

const NO_BOOST = {
	applyWeight: false,
	applyHeadingBoost: false,
	applyOverlapBoost: false,
} as const;

function relClose(a: number, b: number, tol = 1e-9): boolean {
	const denom = Math.max(Math.abs(a), Math.abs(b), 1e-12);
	return Math.abs(a - b) / denom < tol;
}

describe("hybridSearch — RRF 융합", () => {
	it("BM25·벡터 양쪽에 걸린 청크가 한쪽 1위보다 높다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("a.md");
			m.addNote("b.md");
			m.addNote("c.md");
			// A: BM25 전용(강한 tf), B: 벡터 전용, C: 양쪽 중간
			const a = m.addChunk("a.md", {
				text: "알파 베타 알파 베타",
				terms: ["알파", "베타", "알파", "베타"],
			});
			const b = m.addChunk("b.md", {
				text: "감마",
				terms: ["감마"],
				vec: [1, 0, 0, 0],
			});
			const c = m.addChunk("c.md", {
				text: "알파 베타",
				terms: ["알파", "베타"],
				vec: [0.9, 0.1, 0, 0],
			});
			const hits = hybridSearch(
				m.db,
				["알파", "베타"],
				vecOf(1, 0, 0, 0),
				NO_BOOST,
			);
			expect(hits[0].chunkId).toBe(c); // 1/62 + 1/62 > 1/61
			const hitA = hits.find((h) => h.chunkId === a)!;
			const hitB = hits.find((h) => h.chunkId === b)!;
			expect(hitA.bm25Rank).toBe(1);
			expect(hitA.vectorRank).toBeNull();
			expect(hitB.vectorRank).toBe(1);
			expect(hitB.bm25Rank).toBeNull();
			expect(relClose(hitA.rrfScore, hitB.rrfScore)).toBe(true); // 둘 다 1/61
		} finally {
			m.close();
		}
	});
});

describe("hybridSearch — 가중치", () => {
	it("가중치 0.15→1.5 변경 시 finalScore가 정확히 10배, 다른 조건 불변", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md", { weight: 0.15 });
			const id = m.addChunk("n.md", {
				text: "알파 베타",
				terms: ["알파", "베타"],
			});
			const lo = hybridSearch(m.db, ["알파", "베타"], null);
			expect(lo).toHaveLength(1);
			expect(lo[0].chunkId).toBe(id);
			m.db.run("UPDATE notes SET weight = 1.5 WHERE path = 'n.md'");
			const hi = hybridSearch(m.db, ["알파", "베타"], null);
			expect(relClose(hi[0].finalScore / lo[0].finalScore, 10)).toBe(
				true,
			);
			expect(relClose(hi[0].rrfScore, lo[0].rrfScore)).toBe(true);
		} finally {
			m.close();
		}
	});

	it("가중치가 낮은 강한 매칭을 가중치가 높은 약한 매칭이 이긴다 (설계 특성)", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("strong-low.md", { weight: 0.15 });
			m.addNote("weak-high.md", { weight: 1.5 });
			m.addChunk("strong-low.md", {
				text: "알파 베타 알파 베타",
				terms: ["알파", "베타", "알파", "베타"],
			});
			m.addChunk("weak-high.md", {
				text: "알파 베타",
				terms: ["알파", "베타"],
			});
			const hits = hybridSearch(m.db, ["알파", "베타"], null);
			expect(hits[0].notePath).toBe("weak-high.md");
		} finally {
			m.close();
		}
	});

	it("가중치 0인 노트는 결과에서 완전히 배제된다 (SQL 게이트)", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("zero.md", { weight: 0 });
			m.addNote("one.md", { weight: 1 });
			m.addChunk("zero.md", {
				text: "알파 베타",
				terms: ["알파", "베타"],
			});
			m.addChunk("one.md", {
				text: "알파 베타",
				terms: ["알파", "베타"],
			});
			const hits = hybridSearch(m.db, ["알파", "베타"], null);
			expect(hits.map((h) => h.notePath)).toEqual(["one.md"]);
		} finally {
			m.close();
		}
	});
});

describe("hybridSearch — 부스트", () => {
	it("헤딩에 쿼리 토큰(2글자+) 포함 시 1.2배, 끄면 원복", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", {
				heading: "알파 선언",
				text: "알파 베타",
				terms: ["알파", "베타"],
			});
			const on = hybridSearch(m.db, ["알파", "베타"], null, {
				applyOverlapBoost: false,
			});
			const off = hybridSearch(m.db, ["알파", "베타"], null, {
				applyOverlapBoost: false,
				applyHeadingBoost: false,
			});
			expect(on[0].headingMatched).toBe(true);
			expect(relClose(on[0].finalScore / off[0].finalScore, 1.2)).toBe(
				true,
			);
		} finally {
			m.close();
		}
	});

	it("1글자 토큰은 헤딩 부스트에서 제외된다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", {
				heading: "물",
				text: "물 알파 베타",
				terms: ["물", "알파", "베타"],
			});
			const hits = hybridSearch(m.db, ["물", "알파", "베타"], null);
			expect(hits[0].headingMatched).toBe(false);
		} finally {
			m.close();
		}
	});

	it("coverage 부스트: 전부 매칭 ×1.5, 끄면 원복", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", {
				text: "알파 베타",
				terms: ["알파", "베타"],
			});
			const on = hybridSearch(m.db, ["알파", "베타"], null);
			const off = hybridSearch(m.db, ["알파", "베타"], null, {
				applyOverlapBoost: false,
			});
			expect(on[0].matchedQueryTerms).toBe(2);
			expect(relClose(on[0].finalScore / off[0].finalScore, 1.5)).toBe(
				true,
			);
		} finally {
			m.close();
		}
	});
});

describe("hybridSearch — 노이즈 필터", () => {
	it("토큰 1개 매칭 + 벡터 없음 → 탈락, 코사인 ≥ 0.6 → 생존", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("both.md");
			m.addNote("one-novec.md");
			m.addNote("one-vec.md");
			// 두 토큰 모두 볼트에 존재하게 만들어 required=2 유지
			m.addChunk("both.md", {
				text: "알파 베타",
				terms: ["알파", "베타"],
			});
			m.addChunk("one-novec.md", { text: "알파", terms: ["알파"] });
			m.addChunk("one-vec.md", {
				text: "알파",
				terms: ["알파"],
				vec: [1, 0, 0, 0],
			});
			const hits = hybridSearch(
				m.db,
				["알파", "베타"],
				vecOf(1, 0, 0, 0),
			);
			const paths = hits.map((h) => h.notePath);
			expect(paths).toContain("both.md");
			expect(paths).toContain("one-vec.md"); // cos 1.0 ≥ 0.6
			expect(paths).not.toContain("one-novec.md");
		} finally {
			m.close();
		}
	});

	it("볼트에 없는(df=0) 토큰은 required에서 제외 — 신조어 1개로 전멸하지 않는다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", { text: "알파", terms: ["알파"] });
			// "신조어9999"는 어떤 청크에도 없음 → effectiveTerms=1 → required=1
			const hits = hybridSearch(m.db, ["알파", "신조어9999"], null);
			expect(hits).toHaveLength(1);
			expect(hits[0].notePath).toBe("n.md");
		} finally {
			m.close();
		}
	});
});

describe("hybridSearch — 기본 동작", () => {
	it("빈 쿼리(토큰 0 + 임베딩 null) → []", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", { text: "알파", terms: ["알파"] });
			expect(hybridSearch(m.db, [], null)).toEqual([]);
		} finally {
			m.close();
		}
	});

	it("topN으로 잘린다", async () => {
		const m = await makeMiniDb();
		try {
			for (let i = 0; i < 5; i++) {
				m.addNote(`n${i}.md`);
				m.addChunk(`n${i}.md`, {
					text: "알파 베타",
					terms: ["알파", "베타"],
				});
			}
			const hits = hybridSearch(m.db, ["알파", "베타"], null, {
				topN: 3,
			});
			expect(hits).toHaveLength(3);
		} finally {
			m.close();
		}
	});
});
