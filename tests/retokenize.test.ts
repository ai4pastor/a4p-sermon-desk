// 형태소 재계산(retokenizeAllChunks) — 배치 COMMIT·진행 위치 기록·중단 후 이어서 하기.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => ({ App: class {}, TFile: class {} }));

// 토크나이저 대역 — 공백 분리 + "new:" 표지로 새로 계산된 토큰을 옛 토큰("old")과 구별한다.
const tok = vi.hoisted(() => ({ calls: 0, failOn: null as string | null }));
vi.mock("../src/morpheme", () => ({
	tokenize: async (text: string) => {
		tok.calls++;
		if (text === tok.failOn) throw new Error("tokenize 실패(테스트)");
		return text
			.split(/\s+/)
			.filter(Boolean)
			.map((w) => `new:${w}`);
	},
}));

import {
	retokenizeAllChunks,
	readRetokenizeProgress,
	RETOKENIZE_BATCH,
} from "../src/indexer/indexer";
import {
	getMeta,
	setMeta,
	PROTECTED_FP_KEY,
	RETOKENIZE_PROGRESS_KEY,
} from "../src/db/meta";
import { makeMiniDb, type MiniDb } from "./helpers/mini-db";

/** 청크 n개(본문 "w{i}", 옛 토큰 "old")를 가진 미니 DB와 청크 id 목록. */
async function seed(n: number): Promise<{ m: MiniDb; ids: number[] }> {
	const m = await makeMiniDb();
	m.addNote("a.md");
	const ids: number[] = [];
	for (let i = 1; i <= n; i++) {
		ids.push(m.addChunk("a.md", { text: `w${i}`, terms: ["old"] }));
	}
	return { m, ids };
}

function countTerms(m: MiniDb, where = "1 = 1"): number {
	return Number(
		m.db.exec(`SELECT COUNT(*) FROM chunk_terms WHERE ${where}`)[0].values[0][0],
	);
}

beforeEach(() => {
	tok.calls = 0;
	tok.failOn = null;
});

describe("retokenizeAllChunks — 배치 COMMIT과 이어서 하기", () => {
	it("처음부터 끝까지: 배치마다 콜백, 끝나면 지문 기록·진행 기록 삭제", async () => {
		const n = RETOKENIZE_BATCH * 2 + 100;
		const { m } = await seed(n);
		try {
			let batches = 0;
			const progress: Array<[number, number]> = [];
			const r = await retokenizeAllChunks(
				m.db,
				"fpA",
				(d, t) => progress.push([d, t]),
				async () => {
					batches++;
				},
			);
			expect(r).toEqual({ chunks: n, terms: n, resumedFrom: 0 });
			expect(batches).toBe(3);
			expect(tok.calls).toBe(n);
			expect(countTerms(m, "term = 'old'")).toBe(0);
			expect(countTerms(m)).toBe(n);
			expect(getMeta(m.db, PROTECTED_FP_KEY)).toBe("fpA");
			expect(getMeta(m.db, RETOKENIZE_PROGRESS_KEY)).toBeNull();
			expect(progress[0]).toEqual([0, n]);
			expect(progress[progress.length - 1]).toEqual([n, n]);
		} finally {
			m.close();
		}
	});

	it("중간에 실패하면 끝난 배치까지만 남고, 다시 부르면 남은 청크만 이어서 한다", async () => {
		const n = RETOKENIZE_BATCH * 2 + 100;
		const { m, ids } = await seed(n);
		try {
			tok.failOn = `w${RETOKENIZE_BATCH + 200}`; // 두 번째 배치 한가운데
			await expect(retokenizeAllChunks(m.db, "fpA")).rejects.toThrow(
				"tokenize 실패",
			);
			// 첫 배치만 COMMIT — 두 번째 배치는 ROLLBACK돼 옛 토큰 그대로
			expect(readRetokenizeProgress(m.db, "fpA")).toEqual({
				lastId: ids[RETOKENIZE_BATCH - 1],
				done: RETOKENIZE_BATCH,
			});
			expect(countTerms(m, "term = 'old'")).toBe(n - RETOKENIZE_BATCH);
			expect(getMeta(m.db, PROTECTED_FP_KEY)).toBeNull();

			tok.failOn = null;
			tok.calls = 0;
			const r = await retokenizeAllChunks(m.db, "fpA");
			expect(r.resumedFrom).toBe(RETOKENIZE_BATCH);
			expect(r.chunks).toBe(n);
			expect(tok.calls).toBe(n - RETOKENIZE_BATCH);
			expect(countTerms(m, "term = 'old'")).toBe(0);
			expect(countTerms(m)).toBe(n);
			expect(getMeta(m.db, PROTECTED_FP_KEY)).toBe("fpA");
			expect(getMeta(m.db, RETOKENIZE_PROGRESS_KEY)).toBeNull();
		} finally {
			m.close();
		}
	});

	it("배치 사이에 디스크 저장(export)을 해도 다음 배치가 이어진다", async () => {
		// sql.js export()는 준비된 문장을 모두 해제하고 DB를 다시 연다 — 중간 저장과 같은 상황
		const n = RETOKENIZE_BATCH + 10;
		const { m } = await seed(n);
		try {
			let saves = 0;
			const r = await retokenizeAllChunks(m.db, "fpA", undefined, async () => {
				m.db.export();
				saves++;
			});
			expect(saves).toBe(2);
			expect(r.chunks).toBe(n);
			expect(countTerms(m, "term = 'old'")).toBe(0);
			expect(getMeta(m.db, PROTECTED_FP_KEY)).toBe("fpA");
		} finally {
			m.close();
		}
	});

	it("멈춘 뒤 보호 단어가 바뀌었으면(지문 다름) 기록을 버리고 처음부터 한다", async () => {
		const { m, ids } = await seed(30);
		try {
			setMeta(
				m.db,
				RETOKENIZE_PROGRESS_KEY,
				JSON.stringify({ fp: "fpA", lastId: ids[9] }),
			);
			expect(readRetokenizeProgress(m.db, "fpB")).toBeNull();
			const r = await retokenizeAllChunks(m.db, "fpB");
			expect(r.resumedFrom).toBe(0);
			expect(tok.calls).toBe(30);
		} finally {
			m.close();
		}
	});

	it("이미 반영된 지문이면(전체 재색인 등) 멈춘 기록은 무시한다", async () => {
		const { m, ids } = await seed(30);
		try {
			setMeta(m.db, PROTECTED_FP_KEY, "fpA");
			setMeta(
				m.db,
				RETOKENIZE_PROGRESS_KEY,
				JSON.stringify({ fp: "fpA", lastId: ids[9] }),
			);
			expect(readRetokenizeProgress(m.db, "fpA")).toBeNull();
			const r = await retokenizeAllChunks(m.db, "fpA");
			expect(r.resumedFrom).toBe(0);
			expect(tok.calls).toBe(30);
			expect(getMeta(m.db, RETOKENIZE_PROGRESS_KEY)).toBeNull();
		} finally {
			m.close();
		}
	});

	it("깨진 진행 기록은 무시한다", async () => {
		const { m } = await seed(3);
		try {
			setMeta(m.db, RETOKENIZE_PROGRESS_KEY, "not json");
			expect(readRetokenizeProgress(m.db, "fpA")).toBeNull();
		} finally {
			m.close();
		}
	});
});
