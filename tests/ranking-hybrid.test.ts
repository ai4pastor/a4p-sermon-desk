// hybridSearch 랭킹 불변식 회귀 테스트 — 인메모리 미니 DB.
// 점수 스냅샷이 아니라 비율·순서·포함/제외만 assert한다(시그니처 변화에 강하게).
import { describe, it, expect } from "vitest";
import {
	hybridSearch,
	VECTOR_NOISE_THRESHOLD,
	VECTOR_STRONG_SIM,
} from "../src/search/hybrid";

/** 코사인이 정확히 c인 단위벡터(쿼리 [1,0,0,0] 기준). */
function vecWithCos(c: number): number[] {
	return [c, Math.sqrt(1 - c * c), 0, 0];
}
import { makeMiniDb, vecOf } from "./helpers/mini-db";

const NO_BOOST = {
	applyWeight: false,
	applyHeadingBoost: false,
	applyOverlapBoost: false,
	applyCosineBoost: false,
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

describe("hybridSearch — 🔬 분석 trace", () => {
	it("matchedTerms는 실제 토큰 문자열, rrfBm25+rrfVector = rrfScore, passedBy 사유", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("a.md");
			m.addNote("b.md");
			m.addNote("c.md");
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
			const hits = hybridSearch(m.db, ["알파", "베타"], vecOf(1, 0, 0, 0));
			for (const h of hits) {
				expect(h.trace).toBeDefined();
				expect(
					relClose(h.trace!.rrfBm25 + h.trace!.rrfVector, h.rrfScore),
				).toBe(true);
				expect(h.trace!.matchedTerms.length).toBe(h.matchedQueryTerms);
				expect(h.trace!.effectiveTerms).toBe(2);
				expect(h.trace!.requiredTerms).toBe(2);
			}
			const byId = (id: number) => hits.find((h) => h.chunkId === id)!;
			expect(byId(a).trace!.matchedTerms).toEqual(["알파", "베타"]);
			expect(byId(a).trace!.passedBy).toBe("terms");
			expect(byId(a).trace!.rrfVector).toBe(0);
			expect(byId(b).trace!.matchedTerms).toEqual([]);
			expect(byId(b).trace!.passedBy).toBe("vector");
			expect(byId(b).trace!.rrfBm25).toBe(0);
			expect(byId(c).trace!.passedBy).toBe("both");
		} finally {
			m.close();
		}
	});

	it("검색어 0개(의미 검색만): requiredTerms 0, 벡터 히트는 both가 아닌 terms+vector 규칙대로", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("v.md");
			m.addChunk("v.md", { text: "본문", vec: [1, 0, 0, 0] });
			const hits = hybridSearch(m.db, [], vecOf(1, 0, 0, 0));
			expect(hits.length).toBe(1);
			const t = hits[0].trace!;
			expect(t.requiredTerms).toBe(0);
			expect(t.effectiveTerms).toBe(0);
			expect(t.matchedTerms).toEqual([]);
			// matched 0 >= required 0 이므로 terms도 충족 → both
			expect(t.passedBy).toBe("both");
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

describe("hybridSearch — resolveWeight 주입 (테마 프로파일)", () => {
	it("주입된 해석기가 DB weight를 대체한다 (배지 noteWeight 포함)", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md", { weight: 1.5 }); // DB(scope)는 10점
			m.addChunk("n.md", { text: "알파 베타", terms: ["알파", "베타"] });
			const dbView = hybridSearch(m.db, ["알파", "베타"], null);
			const profView = hybridSearch(m.db, ["알파", "베타"], null, {
				resolveWeight: () => 0.15, // 활성 프로파일은 1점
			});
			expect(relClose(dbView[0].noteWeight, 1.5)).toBe(true);
			expect(relClose(profView[0].noteWeight, 0.15)).toBe(true);
			expect(
				relClose(dbView[0].finalScore / profView[0].finalScore, 10),
			).toBe(true);
		} finally {
			m.close();
		}
	});

	it("해석기가 0을 반환한 노트는 결과에서 제외된다 (DB weight가 커도)", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("on.md", { weight: 1.5 });
			m.addNote("off.md", { weight: 1.5 });
			for (const p of ["on.md", "off.md"]) {
				m.addChunk(p, { text: "알파 베타", terms: ["알파", "베타"] });
			}
			const hits = hybridSearch(m.db, ["알파", "베타"], null, {
				resolveWeight: (p) => (p === "off.md" ? 0 : 1),
			});
			expect(hits.map((h) => h.notePath)).toEqual(["on.md"]);
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

describe("hybridSearch — 커버리지 조건·코사인 보너스 (0.8.0)", () => {
	it("검색어 1개면 커버리지 보너스 없음(끄나 켜나 동일), 2개면 ×1.5", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", { text: "알파 베타", terms: ["알파", "베타"] });
			const one = hybridSearch(m.db, ["알파"], null);
			const oneOff = hybridSearch(m.db, ["알파"], null, {
				applyOverlapBoost: false,
			});
			expect(one[0].matchedQueryTerms).toBe(1);
			expect(relClose(one[0].finalScore, oneOff[0].finalScore)).toBe(true);
			const two = hybridSearch(m.db, ["알파", "베타"], null);
			const twoOff = hybridSearch(m.db, ["알파", "베타"], null, {
				applyOverlapBoost: false,
			});
			expect(relClose(two[0].finalScore / twoOff[0].finalScore, 1.5)).toBe(
				true,
			);
		} finally {
			m.close();
		}
	});

	it("코사인 보너스: 강한 일치(≥VECTOR_STRONG_SIM) → ×1.5, 문턱 정확히 → ×1.0, 끄면 원복", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("hi.md");
			m.addNote("lo.md");
			m.addChunk("hi.md", { text: "본문", vec: vecWithCos(VECTOR_STRONG_SIM) });
			m.addChunk("lo.md", { text: "본문", vec: vecWithCos(VECTOR_NOISE_THRESHOLD) });
			const on = hybridSearch(m.db, [], vecOf(1, 0, 0, 0));
			const off = hybridSearch(m.db, [], vecOf(1, 0, 0, 0), {
				applyCosineBoost: false,
			});
			const pick = (hits: typeof on, p: string) =>
				hits.find((h) => h.notePath === p)!;
			expect(relClose(pick(on, "hi.md").vectorScore!, VECTOR_STRONG_SIM, 1e-6)).toBe(true);
			expect(
				relClose(pick(on, "hi.md").finalScore / pick(off, "hi.md").finalScore, 1.5),
			).toBe(true);
			expect(
				relClose(pick(on, "lo.md").vectorScore!, VECTOR_NOISE_THRESHOLD, 1e-6),
			).toBe(true);
			expect(
				relClose(pick(on, "lo.md").finalScore, pick(off, "lo.md").finalScore, 1e-6),
			).toBe(true);
		} finally {
			m.close();
		}
	});

	it("의미 전용 1위(유사도 1.0)가 단일 토큰 어휘 전용 하위 후보보다 위에 온다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("sem.md");
			m.addChunk("sem.md", { text: "본문", vec: [1, 0, 0, 0] });
			// 어휘 전용 후보 12개 — tf가 큰 순으로 1..12위
			for (let i = 0; i < 12; i++) {
				m.addNote(`lex${i}.md`);
				m.addChunk(`lex${i}.md`, {
					text: "알파",
					terms: Array(12 - i).fill("알파"),
				});
			}
			const hits = hybridSearch(m.db, ["알파"], vecOf(1, 0, 0, 0), {
				topN: 20,
				candidateK: 30,
			});
			const semIdx = hits.findIndex((h) => h.notePath === "sem.md");
			expect(semIdx).toBeGreaterThanOrEqual(0);
			// 1/61×1.5 = 0.02459 vs 어휘 1위 1/61 = 0.01639 → 의미 전용이 1위
			expect(semIdx).toBe(0);
		} finally {
			m.close();
		}
	});
});

describe("hybridSearch — 노이즈 필터", () => {
	it("토큰 1개 매칭 + 벡터 없음 → 탈락, 코사인 ≥ 문턱 → 생존", async () => {
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
			expect(paths).toContain("one-vec.md"); // cos 1.0 ≥ 문턱
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

	it("초대형 쿼리(토큰 900+)도 바인딩 한도 예외 없이 동작한다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", { text: "알파 베타", terms: ["알파", "베타"] });
			const huge = ["알파", "베타"];
			for (let i = 0; i < 900; i++) huge.push(`토큰${i}`);
			const hits = hybridSearch(m.db, huge, null);
			expect(hits).toHaveLength(1);
			expect(hits[0].notePath).toBe("n.md");
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

describe("hybridSearch — 프로파일 인지 후보 게이트 (0.11.0)", () => {
	// 시나리오: zero/ 폴더는 DB(scope)에서는 사용 중(1.5)이지만 활성 프로파일에서는
	// 0점. 예전에는 이 청크들이 후보 K개를 먼저 차지한 뒤 버려져 on/ 청크가 후보에
	// 들지 못했다. 이제 후보 단계에서 걸러져 on/ 청크가 전부 살아남아야 한다.
	function seedBm25(m: Awaited<ReturnType<typeof makeMiniDb>>) {
		for (let i = 12; i >= 1; i--) {
			const p = `zero/${i}.md`;
			m.addNote(p, { weight: 1.5 });
			m.addChunk(p, { text: "알파", terms: Array<string>(i).fill("알파") });
		}
		for (let i = 1; i <= 3; i++) {
			const p = `on/${i}.md`;
			m.addNote(p, { weight: 1.5 });
			m.addChunk(p, { text: "알파", terms: ["알파"] });
		}
	}

	it("BM25: 활성 프로파일 0점 노트가 후보 K를 소모하지 않는다", async () => {
		const m = await makeMiniDb();
		try {
			seedBm25(m);
			const hits = hybridSearch(m.db, ["알파"], null, {
				candidateK: 10,
				resolveWeight: (p) => (p.startsWith("zero/") ? 0 : 1),
			});
			expect(hits).toHaveLength(3);
			expect(hits.every((h) => h.notePath.startsWith("on/"))).toBe(true);
		} finally {
			m.close();
		}
	});

	it("BM25: 해석기 미지정이면 DB weight 기준 전 청크가 후보 (기존 동작 유지)", async () => {
		const m = await makeMiniDb();
		try {
			seedBm25(m);
			const hits = hybridSearch(m.db, ["알파"], null, { candidateK: 10 });
			// tf가 큰 zero/12..zero/3이 후보 10개를 채운다.
			expect(hits).toHaveLength(10);
			expect(hits.every((h) => h.notePath.startsWith("zero/"))).toBe(true);
		} finally {
			m.close();
		}
	});

	it("벡터: 활성 프로파일 0점 노트가 후보 K를 소모하지 않는다", async () => {
		const m = await makeMiniDb();
		try {
			for (let i = 1; i <= 12; i++) {
				const p = `zero/${i}.md`;
				m.addNote(p, { weight: 1.5 });
				m.addChunk(p, { text: "x", vec: vecWithCos(0.99) });
			}
			for (let i = 1; i <= 3; i++) {
				const p = `on/${i}.md`;
				m.addNote(p, { weight: 1.5 });
				m.addChunk(p, { text: "y", vec: vecWithCos(0.9) });
			}
			const hits = hybridSearch(m.db, [], vecOf(1, 0, 0, 0), {
				candidateK: 10,
				resolveWeight: (p) => (p.startsWith("zero/") ? 0 : 1),
			});
			expect(hits).toHaveLength(3);
			expect(hits.every((h) => h.notePath.startsWith("on/"))).toBe(true);
			// 살아남은 히트의 점수 구성은 예전과 같은 규칙(벡터 순위 1~3).
			expect(hits.map((h) => h.vectorRank).sort()).toEqual([1, 2, 3]);
		} finally {
			m.close();
		}
	});
});
