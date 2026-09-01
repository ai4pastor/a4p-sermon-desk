// tagSearch 랭킹 불변식 회귀 테스트 — 인메모리 미니 DB.
import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
	normalizePath: (p: string) => p.replace(/\/+/g, "/"),
	Notice: class {},
	Plugin: class {},
	App: class {},
	TFile: class {},
}));
// tagSearch는 tokenize를 호출하지 않지만 tag.ts가 ../morpheme(wasm import)를
// 정적 import하므로 노드에서 로드하려면 스텁이 필요하다.
vi.mock("../src/morpheme", () => ({
	tokenize: async () => [],
	hasHangul: () => true,
	isStopword: () => false,
	preloadMorpheme: async () => {},
	destroyMorpheme: () => {},
}));

import type { App } from "obsidian";
import { tagSearch, type QueryKeys } from "../src/search/tag";
import { makeMiniDb } from "./helpers/mini-db";

const appStub = {} as unknown as App;

function keysOf(partial: Partial<QueryKeys>): QueryKeys {
	return {
		dExact: new Set(),
		dSyn: new Set(),
		tExact: new Set(),
		dVec: new Set(),
		tVec: new Set(),
		...partial,
	};
}

describe("tagSearch — 가중합", () => {
	it("dExact 3 > dSyn 2 > dVec 1 = tExact 1 > tVec 0.5 순으로 점수가 매겨진다", async () => {
		const m = await makeMiniDb();
		try {
			const setups: Array<["doctrine" | "tag", string, string]> = [
				["doctrine", "d-exact.md", "칭의"],
				["doctrine", "d-syn.md", "구원"],
				["doctrine", "d-vec.md", "성화"],
				["tag", "t-exact.md", "감사"],
				["tag", "t-vec.md", "거룩한삶"],
			];
			for (const [kind, path, key] of setups) {
				m.addNote(path);
				m.addChunk(path, { text: `${key} 본문` });
				if (kind === "doctrine") m.addDoctrine(path, key);
				else m.addTag(path, key);
			}
			const hits = tagSearch(
				m.db,
				keysOf({
					dExact: new Set(["칭의"]),
					dSyn: new Set(["구원"]),
					dVec: new Set(["성화"]),
					tExact: new Set(["감사"]),
					tVec: new Set(["거룩한삶"]),
				}),
				appStub,
			);
			const score = (p: string) =>
				hits.find((h) => h.notePath === p)?.finalScore;
			expect(score("d-exact.md")).toBeCloseTo(3, 9);
			expect(score("d-syn.md")).toBeCloseTo(2, 9);
			expect(score("d-vec.md")).toBeCloseTo(1, 9);
			expect(score("t-exact.md")).toBeCloseTo(1, 9);
			expect(score("t-vec.md")).toBeCloseTo(0.5, 9);
			expect(hits[0].notePath).toBe("d-exact.md");
		} finally {
			m.close();
		}
	});

	it("같은 키가 dExact와 dSyn에 동시에 있으면 dExact 가중치(3)만 계산된다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", { text: "본문" });
			m.addDoctrine("n.md", "칭의");
			const hits = tagSearch(
				m.db,
				keysOf({
					dExact: new Set(["칭의"]),
					dSyn: new Set(["칭의"]),
				}),
				appStub,
			);
			expect(hits[0].finalScore).toBeCloseTo(3, 9);
		} finally {
			m.close();
		}
	});

	it("여러 키 매칭은 합산되고 matchedQueryTerms는 실제 키 수", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", { text: "본문" });
			m.addDoctrine("n.md", "칭의");
			m.addTag("n.md", "감사");
			const hits = tagSearch(
				m.db,
				keysOf({
					dExact: new Set(["칭의"]),
					tExact: new Set(["감사"]),
				}),
				appStub,
			);
			expect(hits[0].finalScore).toBeCloseTo(4, 9); // 3 + 1
			expect(hits[0].matchedQueryTerms).toBe(2);
			expect(hits[0].queryTermsTotal).toBe(2);
		} finally {
			m.close();
		}
	});
});

describe("tagSearch — 가중치·제외", () => {
	it("finalScore = rawScore × noteWeight, weight 0은 결과에서 제외", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("hi.md", { weight: 1.5 });
			m.addNote("zero.md", { weight: 0 });
			for (const p of ["hi.md", "zero.md"]) {
				m.addChunk(p, { text: "본문" });
				m.addDoctrine(p, "칭의");
			}
			const hits = tagSearch(
				m.db,
				keysOf({ dExact: new Set(["칭의"]) }),
				appStub,
			);
			expect(hits.map((h) => h.notePath)).toEqual(["hi.md"]);
			expect(hits[0].finalScore).toBeCloseTo(3 * 1.5, 9);
			expect(hits[0].noteWeight).toBeCloseTo(1.5, 9);
		} finally {
			m.close();
		}
	});

	it("excludePath로 현재 노트를 제외한다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("keep.md");
			m.addNote("cur.md");
			for (const p of ["keep.md", "cur.md"]) {
				m.addChunk(p, { text: "본문" });
				m.addDoctrine(p, "칭의");
			}
			const hits = tagSearch(
				m.db,
				keysOf({ dExact: new Set(["칭의"]) }),
				appStub,
				{ excludePath: "cur.md" },
			);
			expect(hits.map((h) => h.notePath)).toEqual(["keep.md"]);
		} finally {
			m.close();
		}
	});
});

describe("tagSearch — 대표 청크", () => {
	it("노트의 첫 청크(ord 최소)가 미리보기 대표가 된다 (현행 스펙 고정)", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			const first = m.addChunk("n.md", { text: "첫 번째 청크" });
			m.addChunk("n.md", { text: "두 번째 청크 — 매칭 근거는 여기" });
			m.addDoctrine("n.md", "칭의");
			const hits = tagSearch(
				m.db,
				keysOf({ dExact: new Set(["칭의"]) }),
				appStub,
			);
			expect(hits[0].chunkId).toBe(first);
			expect(hits[0].preview).toContain("첫 번째");
		} finally {
			m.close();
		}
	});

	it("키가 하나도 없으면 []", async () => {
		const m = await makeMiniDb();
		try {
			expect(tagSearch(m.db, keysOf({}), appStub)).toEqual([]);
		} finally {
			m.close();
		}
	});
});
