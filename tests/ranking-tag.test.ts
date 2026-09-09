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
			// 추천 근거 칩 데이터 — 키와 종류가 채워진다
			const mk = (hits[0].matchedKeys ?? [])
				.map((k) => `${k.kind}:${k.key}`)
				.sort();
			expect(mk).toEqual(["dExact:칭의", "tExact:감사"]);
		} finally {
			m.close();
		}
	});

	it("matchedKeys[].weight 사다리(3/2/1/1/0.5)와 rawScore = Σweight, vecSims → sim 전파", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", { text: "본문" });
			for (const k of ["칭의", "구원", "성화"]) m.addDoctrine("n.md", k);
			for (const k of ["감사", "거룩한삶"]) m.addTag("n.md", k);
			const hits = tagSearch(
				m.db,
				keysOf({
					dExact: new Set(["칭의"]),
					dSyn: new Set(["구원"]),
					dVec: new Set(["성화"]),
					tExact: new Set(["감사"]),
					tVec: new Set(["거룩한삶"]),
					vecSims: new Map([
						["성화", 0.548],
						["거룩한삶", 0.77],
					]),
				}),
				appStub,
			);
			const keys = hits[0].matchedKeys ?? [];
			const w = Object.fromEntries(keys.map((k) => [k.key, k.weight]));
			expect(w).toEqual({ 칭의: 3, 구원: 2, 성화: 1, 감사: 1, 거룩한삶: 0.5 });
			expect(hits[0].rawScore).toBeCloseTo(7.5, 9);
			expect(hits[0].finalScore).toBeCloseTo(7.5 * 1.0, 9);
			const sim = Object.fromEntries(keys.map((k) => [k.key, k.sim]));
			expect(sim["성화"]).toBe(0.548);
			expect(sim["거룩한삶"]).toBe(0.77);
			expect(sim["칭의"]).toBeUndefined();
			expect(sim["감사"]).toBeUndefined();
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

	it("resolveWeight 주입 시 DB weight 대신 프로파일 가중치가 곱해지고 0은 제외", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("on.md", { weight: 1.5 });
			m.addNote("off.md", { weight: 1.5 });
			for (const p of ["on.md", "off.md"]) {
				m.addChunk(p, { text: "본문" });
				m.addDoctrine(p, "칭의");
			}
			const hits = tagSearch(
				m.db,
				keysOf({ dExact: new Set(["칭의"]) }),
				appStub,
				{ resolveWeight: (p) => (p === "off.md" ? 0 : 0.3) },
			);
			expect(hits.map((h) => h.notePath)).toEqual(["on.md"]);
			expect(hits[0].finalScore).toBeCloseTo(3 * 0.3, 9);
			expect(hits[0].noteWeight).toBeCloseTo(0.3, 9);
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
	it("매칭 키가 본문에 나오는 첫 청크가 대표가 된다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			m.addChunk("n.md", { text: "첫 번째 청크" });
			const second = m.addChunk("n.md", { text: "두 번째 청크 — 칭의가 여기" });
			m.addChunk("n.md", { text: "세 번째 청크 — 칭의 또 등장" });
			m.addDoctrine("n.md", "칭의");
			const hits = tagSearch(
				m.db,
				keysOf({ dExact: new Set(["칭의"]) }),
				appStub,
			);
			expect(hits[0].chunkId).toBe(second);
			expect(hits[0].preview).toContain("칭의");
		} finally {
			m.close();
		}
	});

	it("키가 본문 어디에도 없으면 첫 청크(ord 최소)로 폴백", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("n.md");
			const first = m.addChunk("n.md", { text: "첫 번째 청크" });
			m.addChunk("n.md", { text: "두 번째 청크" });
			m.addDoctrine("n.md", "칭의");
			const hits = tagSearch(
				m.db,
				keysOf({ dExact: new Set(["칭의"]) }),
				appStub,
			);
			expect(hits[0].chunkId).toBe(first);
		} finally {
			m.close();
		}
	});

	it("동점이면 매칭 키 수 → 최근 수정(mtime) 순으로 정렬된다", async () => {
		const m = await makeMiniDb();
		try {
			// 세 노트 모두 dExact 1키(3점) 동점, old/new는 키 수도 같음
			for (const p of ["old.md", "new.md", "two.md"]) {
				m.addNote(p);
				m.addChunk(p, { text: `${p} 본문` });
				m.addDoctrine(p, "칭의");
			}
			m.addTag("two.md", "감사"); // two: 3 + 1 = 4점 → 1위
			m.db.run("UPDATE notes SET mtime = 100 WHERE path = 'old.md'");
			m.db.run("UPDATE notes SET mtime = 200 WHERE path = 'new.md'");
			const hits = tagSearch(
				m.db,
				keysOf({ dExact: new Set(["칭의"]), tExact: new Set(["감사"]) }),
				appStub,
			);
			expect(hits.map((h) => h.notePath)).toEqual(["two.md", "new.md", "old.md"]);
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
