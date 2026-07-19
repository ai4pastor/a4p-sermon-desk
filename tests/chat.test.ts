import { describe, it, expect } from "vitest";
import type { HybridHit } from "../src/search/hybrid";
import {
	CHAT_SYSTEM_PROMPT,
	CHAT_MAX_HISTORY_TURNS,
	EMPTY_CONTEXT_MARKER,
	MAX_CHUNK_CHARS,
	MAX_CONTEXT_CHARS,
	capPerNote,
	buildContext,
	buildContextBlock,
	maxContextCharsFor,
	parseCiteNumbers,
	trimHistory,
	buildChatMessages,
	type ChatMessage,
} from "../src/chat/rag";

function hit(partial: Partial<HybridHit>): HybridHit {
	return {
		chunkId: 1,
		notePath: "A/a.md",
		noteTitle: "a",
		heading: null,
		preview: "",
		fullText: "본문",
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

describe("capPerNote", () => {
	it("노트당 최대 개수를 넘는 청크를 제외한다 (순서 유지)", () => {
		const hits = [
			hit({ chunkId: 1, notePath: "A.md", finalScore: 5 }),
			hit({ chunkId: 2, notePath: "B.md", finalScore: 4 }),
			hit({ chunkId: 3, notePath: "A.md", finalScore: 3 }),
			hit({ chunkId: 4, notePath: "A.md", finalScore: 2 }),
			hit({ chunkId: 5, notePath: "B.md", finalScore: 1 }),
		];
		const out = capPerNote(hits, 2);
		expect(out.map((h) => h.chunkId)).toEqual([1, 2, 3, 5]);
	});

	it("빈 입력은 빈 배열", () => {
		expect(capPerNote([], 2)).toEqual([]);
	});
});

describe("buildContextBlock", () => {
	it("번호·제목·heading·경로·본문 형식으로 조립한다", () => {
		const block = buildContextBlock([
			hit({
				noteTitle: "시편 23",
				heading: "1. 목자",
				notePath: "Sermons/시편 23.md",
				fullText: "여호와는 나의 목자시니",
			}),
			hit({
				noteTitle: "묵상",
				heading: null,
				notePath: "Notes/묵상.md",
				fullText: "부족함이 없으리로다",
			}),
		]);
		expect(block).toContain(
			"[1] 시편 23 › 1. 목자 (Sermons/시편 23.md)\n여호와는 나의 목자시니",
		);
		expect(block).toContain("[2] 묵상 (Notes/묵상.md)\n부족함이 없으리로다");
	});

	it("긴 청크는 MAX_CHUNK_CHARS에서 절단한다", () => {
		const long = "가".repeat(MAX_CHUNK_CHARS + 500);
		const block = buildContextBlock([hit({ fullText: long })]);
		expect(block.length).toBeLessThan(MAX_CHUNK_CHARS + 200);
		expect(block).toContain("…");
	});

	it("총량 캡을 넘기면 이후 청크를 통째로 제외한다", () => {
		const chunk = "나".repeat(MAX_CHUNK_CHARS);
		const hits = Array.from({ length: 20 }, (_, i) =>
			hit({ chunkId: i, notePath: `N${i}.md`, fullText: chunk }),
		);
		const block = buildContextBlock(hits);
		expect(block.length).toBeLessThanOrEqual(
			MAX_CONTEXT_CHARS + MAX_CHUNK_CHARS,
		);
		// 최소 1개는 항상 포함
		expect(block).toContain("[1]");
		expect(block).not.toContain("[20]");
	});

	it("0건이면 마커를 반환한다", () => {
		expect(buildContextBlock([])).toBe(EMPTY_CONTEXT_MARKER);
		expect(buildContext([]).used).toEqual([]);
	});

	it("maxContextCharsFor(topK)를 넘기면 최대 길이 청크 topK개가 전부 포함된다", () => {
		const chunk = "라".repeat(MAX_CHUNK_CHARS * 2);
		const hits = Array.from({ length: 15 }, (_, i) =>
			hit({ chunkId: i, notePath: `N${i}.md`, fullText: chunk }),
		);
		const { used } = buildContext(hits, maxContextCharsFor(15));
		expect(used.length).toBe(15);
	});

	it("used는 블록에 실제 포함된 청크와 1:1 대응한다", () => {
		const chunk = "다".repeat(MAX_CHUNK_CHARS);
		const hits = Array.from({ length: 20 }, (_, i) =>
			hit({ chunkId: i, notePath: `N${i}.md`, fullText: chunk }),
		);
		const { block, used } = buildContext(hits);
		expect(used.length).toBeLessThan(hits.length);
		expect(block).toContain(`[${used.length}]`);
		expect(block).not.toContain(`[${used.length + 1}]`);
		expect(used[0].chunkId).toBe(0);
	});
});

describe("parseCiteNumbers", () => {
	it("단일·묶음·범위 표기를 모두 해석한다", () => {
		expect(parseCiteNumbers("3", 8)).toEqual([3]);
		expect(parseCiteNumbers("1, 2", 8)).toEqual([1, 2]);
		expect(parseCiteNumbers("1,2,5", 8)).toEqual([1, 2, 5]);
		expect(parseCiteNumbers("1-3", 8)).toEqual([1, 2, 3]);
		expect(parseCiteNumbers("2~4", 8)).toEqual([2, 3, 4]);
		expect(parseCiteNumbers("1, 1", 8)).toEqual([1]);
	});

	it("범위를 벗어나거나 인용이 아닌 표기는 null", () => {
		expect(parseCiteNumbers("9", 8)).toBeNull();
		expect(parseCiteNumbers("0", 8)).toBeNull();
		expect(parseCiteNumbers("3-1", 8)).toBeNull();
		expect(parseCiteNumbers("2026", 8)).toBeNull();
		expect(parseCiteNumbers("1a", 8)).toBeNull();
		expect(parseCiteNumbers("", 8)).toBeNull();
		expect(parseCiteNumbers("1", 0)).toBeNull();
	});
});

describe("trimHistory", () => {
	const msg = (role: "user" | "assistant", i: number): ChatMessage => ({
		role,
		content: `m${i}`,
	});

	it("최근 N개만 남긴다", () => {
		const msgs: ChatMessage[] = [];
		for (let i = 0; i < 5; i++) {
			msgs.push(msg("user", i * 2), msg("assistant", i * 2 + 1));
		}
		const out = trimHistory(msgs, 4);
		expect(out.map((m) => m.content)).toEqual(["m6", "m7", "m8", "m9"]);
	});

	it("assistant로 시작하지 않게 쌍 경계를 지킨다", () => {
		const msgs: ChatMessage[] = [
			msg("user", 0),
			msg("assistant", 1),
			msg("user", 2),
			msg("assistant", 3),
		];
		const out = trimHistory(msgs, 3);
		expect(out[0].role).toBe("user");
		expect(out.map((m) => m.content)).toEqual(["m2", "m3"]);
	});

	it("N 이하면 그대로", () => {
		const msgs = [msg("user", 0), msg("assistant", 1)];
		expect(trimHistory(msgs, 6)).toEqual(msgs);
	});
});

describe("buildChatMessages", () => {
	it("system이 첫 메시지이고 최신 질문에 자료+질문이 붙는다", () => {
		const out = buildChatMessages([], "십자가란?", "[1] a (a.md)\n본문");
		expect(out[0]).toEqual({
			role: "system",
			content: CHAT_SYSTEM_PROMPT,
		});
		const last = out[out.length - 1];
		expect(last.role).toBe("user");
		expect(last.content).toContain("[노트 자료]\n[1] a (a.md)\n본문");
		expect(last.content).toContain("[질문]\n십자가란?");
	});

	it("이전 턴은 표시 텍스트만 포함하고 히스토리 캡을 지킨다", () => {
		const history: ChatMessage[] = [];
		for (let i = 0; i < 10; i++) {
			history.push(
				{ role: "user", content: `q${i}` },
				{ role: "assistant", content: `a${i}` },
			);
		}
		const out = buildChatMessages(history, "새 질문", "자료");
		// system + 히스토리(≤캡) + 최신 user
		expect(out.length).toBe(1 + CHAT_MAX_HISTORY_TURNS + 1);
		const mid = out.slice(1, -1);
		expect(mid.every((m) => !m.content.includes("[노트 자료]"))).toBe(true);
		expect(mid[0].role).toBe("user");
	});
});
