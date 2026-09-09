// 아이디어 메모 순수 함수 테스트 — src/idea-memo.ts (obsidian 미의존).
import { describe, it, expect } from "vitest";
import {
	IDEA_MEMO_THOUGHTS_HEADING,
	IDEA_TITLE_MAX,
	composeIdeaMemo,
	deriveIdeaTitle,
	formatFmDate,
	uniqueIdeaPath,
	yamlQuote,
} from "../src/idea-memo";

const NOW = new Date(2026, 8, 9, 13, 5); // 2026-09-09 13:05 (로컬)

describe("formatFmDate — YYYY-MM-DDTHH:mm", () => {
	it("월·일·시·분을 0으로 채운다", () => {
		expect(formatFmDate(NOW)).toBe("2026-09-09T13:05");
		expect(formatFmDate(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01T00:00");
	});
});

describe("yamlQuote", () => {
	it('큰따옴표로 감싸고 \\ " 를 이스케이프한다', () => {
		expect(yamlQuote("[[노트]]")).toBe('"[[노트]]"');
		expect(yamlQuote('a "b" c')).toBe('"a \\"b\\" c"');
		expect(yamlQuote("a\\b")).toBe('"a\\\\b"');
	});
});

describe("deriveIdeaTitle — 선택 첫 줄 → 파일명", () => {
	it("첫 비공백 줄만 쓴다(앞 빈 줄·CRLF 무시)", () => {
		expect(
			deriveIdeaTitle("\r\n\r\n  믿음은 들음에서 납니다.\r\n둘째 줄", NOW),
		).toBe("믿음은 들음에서 납니다");
	});
	it("인용·헤딩·목록·콜아웃 마커를 걷어낸다", () => {
		expect(deriveIdeaTitle("> > 인용 문장", NOW)).toBe("인용 문장");
		expect(deriveIdeaTitle("## 소제목", NOW)).toBe("소제목");
		expect(deriveIdeaTitle("- 목록 항목", NOW)).toBe("목록 항목");
		expect(deriveIdeaTitle("1. 첫째 항목", NOW)).toBe("첫째 항목");
		expect(deriveIdeaTitle("> [!quote]+ [[원본 노트]]", NOW)).toBe("원본 노트");
	});
	it("위키링크는 표시 텍스트만 남기고 강조 기호를 지운다", () => {
		expect(
			deriveIdeaTitle("[[긴 경로/노트|별칭]] 과 **볼드** ==하이라이트==", NOW),
		).toBe("별칭 과 볼드 하이라이트");
	});
	it("파일명 금지 문자를 제거하고 공백을 압축한다", () => {
		expect(deriveIdeaTitle('왜: "그분"은  #거룩 / 사랑?', NOW)).toBe(
			"왜 그분은 거룩 사랑",
		);
	});
	it("끝의 마침표·공백을 지운다", () => {
		expect(deriveIdeaTitle("문장입니다. ", NOW)).toBe("문장입니다");
	});
	it("40자 초과면 단어 경계로 자른다(20자 이상 남을 때)", () => {
		const long =
			"하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열 열하나 열둘 열셋 열넷 열다섯 열여섯";
		const t = deriveIdeaTitle(long, NOW);
		expect(t.length).toBeLessThanOrEqual(IDEA_TITLE_MAX);
		expect(t.length).toBeGreaterThanOrEqual(20);
		expect(long.startsWith(`${t} `)).toBe(true);
	});
	it("단어 경계가 너무 앞이면 40자에서 그냥 자른다", () => {
		expect(deriveIdeaTitle("가".repeat(60), NOW)).toBe("가".repeat(40));
		const early = `짧게 ${"나".repeat(50)}`;
		expect(deriveIdeaTitle(early, NOW)).toBe(early.slice(0, 40));
	});
	it("장식만 있어 비면 시각 기반 폴백", () => {
		expect(deriveIdeaTitle("###", NOW)).toBe("아이디어 2026-09-09 1305");
		expect(deriveIdeaTitle("[[]]", NOW)).toBe("아이디어 2026-09-09 1305");
		expect(deriveIdeaTitle("   \n\n", NOW)).toBe("아이디어 2026-09-09 1305");
	});
});

describe("uniqueIdeaPath — 충돌 시 ' 2', ' 3'", () => {
	it("없으면 그대로", () => {
		expect(
			uniqueIdeaPath("100. notes/140. Ideas", "제목", () => false),
		).toBe("100. notes/140. Ideas/제목.md");
	});
	it("끝 슬래시(FolderSuggest 규약)를 허용하고, 빈 폴더는 루트", () => {
		expect(uniqueIdeaPath("A/B/", "t", () => false)).toBe("A/B/t.md");
		expect(uniqueIdeaPath("", "t", () => false)).toBe("t.md");
	});
	it("1회·2회 충돌", () => {
		const taken = new Set(["A/t.md"]);
		expect(uniqueIdeaPath("A", "t", (p) => taken.has(p))).toBe("A/t 2.md");
		taken.add("A/t 2.md");
		expect(uniqueIdeaPath("A", "t", (p) => taken.has(p))).toBe("A/t 3.md");
	});
});

describe("composeIdeaMemo — frontmatter + 인용 콜아웃", () => {
	it("created/modified/source + 콜아웃 + ## 내 생각 + 끝 빈 줄", () => {
		expect(
			composeIdeaMemo({
				selection: "첫 문장.\n둘째 문장.",
				sourceLink: "[[원본 노트]]",
				calloutType: "quote",
				now: NOW,
			}),
		).toBe(
			"---\n" +
				"created: 2026-09-09T13:05\n" +
				"modified: 2026-09-09T13:05\n" +
				'source: "[[원본 노트]]"\n' +
				"---\n" +
				"\n" +
				"> [!quote]+ [[원본 노트]]\n" +
				"> 첫 문장.\n" +
				"> 둘째 문장.\n" +
				"\n" +
				"## 내 생각\n" +
				"\n",
		);
	});
	it("콜아웃 아래 빈 줄 → ## 내 생각 → 빈 줄(커서 착지점)로 끝난다", () => {
		expect(IDEA_MEMO_THOUGHTS_HEADING).toBe("## 내 생각");
		const out = composeIdeaMemo({
			selection: "본문",
			sourceLink: "[[x]]",
			calloutType: "quote",
			now: NOW,
		});
		expect(out.endsWith("> 본문\n\n## 내 생각\n\n")).toBe(true);
	});
	it("sourceLink가 비면 source 줄을 생략하고 제목 줄 뒤 공백이 없다", () => {
		const out = composeIdeaMemo({
			selection: "본문",
			sourceLink: "",
			calloutType: "quote",
			now: NOW,
		});
		expect(out).not.toContain("source:");
		expect(out).toContain("\n> [!quote]+\n> 본문\n");
	});
	it("콜아웃 종류를 바꿀 수 있다(한국어 포함)", () => {
		expect(
			composeIdeaMemo({
				selection: "본문",
				sourceLink: "[[x]]",
				calloutType: "확장필요",
				now: NOW,
			}),
		).toContain("> [!확장필요]+ [[x]]\n");
	});
	it("본문의 --- 는 콜아웃 안에 들어가 frontmatter 구분선이 늘지 않는다", () => {
		const out = composeIdeaMemo({
			selection: "위\n---\n아래",
			sourceLink: "[[x]]",
			calloutType: "quote",
			now: NOW,
		});
		expect(out.split("\n").filter((l) => l === "---")).toHaveLength(2);
		expect(out).toContain("> ---\n");
	});
	it("마크다운 형식 링크도 source에 인용되어 들어간다", () => {
		const out = composeIdeaMemo({
			selection: "본문",
			sourceLink: "[원본](path/원본.md)",
			calloutType: "quote",
			now: NOW,
		});
		expect(out).toContain('source: "[원본](path/원본.md)"\n');
		expect(out).toContain("> [!quote]+ [원본](path/원본.md)\n");
	});
});
