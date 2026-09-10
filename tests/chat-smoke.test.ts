// 실제 OpenAI API를 호출하는 스모크 테스트 (명시적 opt-in).
// A4P_SMOKE_OPENAI_KEY 환경변수가 있을 때만 실행된다:
//   A4P_SMOKE_OPENAI_KEY=sk-... npm test
import { describe, it, expect } from "vitest";
import type { HybridHit } from "../src/search/hybrid";
import { buildContextBlock, buildChatMessages } from "../src/chat/rag";
import { chatComplete } from "../src/chat/complete";

const API_KEY = process.env.A4P_SMOKE_OPENAI_KEY ?? "";

function fakeHit(partial: Partial<HybridHit>): HybridHit {
	return {
		chunkId: 1,
		notePath: "테스트/노트.md",
		noteTitle: "노트",
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

describe("chatComplete 스모크 (실제 API)", () => {
	it.skipIf(!API_KEY)(
		"가짜 노트 자료 기반으로 한국어 답변과 출처 표기를 생성한다",
		{ timeout: 120000 },
		async () => {
			const hits = [
				fakeHit({
					chunkId: 1,
					notePath: "설교/시편 23편.md",
					noteTitle: "시편 23편 설교",
					heading: "1. 여호와는 나의 목자",
					fullText:
						"다윗은 하나님을 목자로 고백한다. 목자는 양을 푸른 초장으로 인도하며, 양은 목자의 음성을 알고 따른다. 이 고백의 핵심은 소유가 아니라 관계다 — '나의' 목자.",
				}),
				fakeHit({
					chunkId: 2,
					notePath: "묵상/요한복음 10장.md",
					noteTitle: "요한복음 10장 묵상",
					fullText:
						"예수님은 자신을 선한 목자라 하신다. 선한 목자는 양을 위해 목숨을 버린다. 시편 23편의 목자 이미지가 예수 그리스도에게서 완성된다.",
				}),
			];
			const messages = buildChatMessages(
				[],
				"내 노트에서 '목자' 이미지가 어떻게 전개되는지 요약해줘",
				buildContextBlock(hits),
				"한국 개신교 목회자의 설교 준비를 돕는 조수",
			);
			const answer = await chatComplete(messages, "gpt-5-mini", API_KEY);
			console.log("\n=== 스모크 테스트 답변 ===\n" + answer + "\n");
			expect(answer.length).toBeGreaterThan(30);
			// 한국어 답변인지 (한글 포함)
			expect(/[가-힣]/.test(answer)).toBe(true);
			// 출처 번호 표기 [1] 또는 [2]
			expect(/\[[12]\]/.test(answer)).toBe(true);
		},
	);
});
