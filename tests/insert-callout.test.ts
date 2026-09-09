// 삽입 방식(링크 | 콜아웃) 순수 함수 테스트 — src/insert.ts (obsidian 미의존).
import { describe, it, expect } from "vitest";
import {
	INSERT_LABEL,
	buildCallout,
	calloutAlias,
	effectiveInsertMode,
} from "../src/insert";

describe("effectiveInsertMode — Option(Alt) 1회 반전", () => {
	it("Alt 없으면 기본 모드 그대로", () => {
		expect(effectiveInsertMode("link", false)).toBe("link");
		expect(effectiveInsertMode("callout", false)).toBe("callout");
	});
	it("Alt면 반대 모드", () => {
		expect(effectiveInsertMode("link", true)).toBe("callout");
		expect(effectiveInsertMode("callout", true)).toBe("link");
	});
});

describe("calloutAlias — 제목 › 헤딩 별칭", () => {
	it("헤딩이 있으면 '제목 › 헤딩'", () => {
		expect(calloutAlias("2024 부활절 설교", "2. 성화의 삶")).toBe(
			"2024 부활절 설교 › 2. 성화의 삶",
		);
	});
	it("헤딩이 없으면 undefined (별칭 없는 [[제목]])", () => {
		expect(calloutAlias("노트", null)).toBeUndefined();
		expect(calloutAlias("노트", "")).toBeUndefined();
	});
	it("링크를 끊는 [ ] | 를 걷어내고 공백을 압축한다", () => {
		expect(calloutAlias("노트", "a | b [c]")).toBe("노트 › a b c");
		expect(calloutAlias("제[목]", "h")).toBe("제 목 › h");
	});
	it("# 은 별칭에서 무해하므로 유지한다", () => {
		expect(calloutAlias("노트", "#태그 제목")).toBe("노트 › #태그 제목");
	});
	it("정제 후 헤딩이 비면 undefined", () => {
		expect(calloutAlias("노트", "|")).toBeUndefined();
		expect(calloutAlias("노트", " [ ] ")).toBeUndefined();
	});
});

describe("buildCallout — 접기 가능 인용 콜아웃", () => {
	const link = "[[2024 부활절 설교#2. 성화의 삶|2024 부활절 설교 › 2. 성화의 삶]]";

	it("제목 줄 + 각 줄 '> ' 접두 + 빈 줄은 '>' + 끝 개행 1개", () => {
		const body =
			"거룩해지는 삶은 단번에 완성되지 않습니다.\n매일의 순종 속에서...\n\n두 번째 문단...";
		expect(buildCallout(link, body)).toBe(
			`> [!quote]+ ${link}\n` +
				"> 거룩해지는 삶은 단번에 완성되지 않습니다.\n" +
				"> 매일의 순종 속에서...\n" +
				">\n" +
				"> 두 번째 문단...\n",
		);
	});
	it("출력 앞에 개행을 붙이지 않는다 (패딩은 호출자 책임)", () => {
		expect(buildCallout("[[x]]", "a").startsWith("> [!quote]+")).toBe(true);
		expect(buildCallout("[[x]]", "a").endsWith("\n")).toBe(true);
		expect(buildCallout("[[x]]", "a").endsWith("\n\n")).toBe(false);
	});
	it("CRLF 입력은 LF 입력과 같다", () => {
		expect(buildCallout("[[x]]", "a\r\nb\r\n\r\nc")).toBe(
			buildCallout("[[x]]", "a\nb\n\nc"),
		);
	});
	it("줄 끝 공백을 지우고, 공백만 있는 줄은 '>'가 된다", () => {
		expect(buildCallout("[[x]]", "a  \n   \nb\t")).toBe(
			"> [!quote]+ [[x]]\n> a\n>\n> b\n",
		);
	});
	it("이미 인용인 줄은 한 번 더 접두되어 중첩 인용이 된다", () => {
		expect(buildCallout("[[x]]", "> 인용\n본문")).toBe(
			"> [!quote]+ [[x]]\n> > 인용\n> 본문\n",
		);
	});
	it("빈 본문·공백만 있는 본문은 제목 줄만", () => {
		expect(buildCallout("[[x]]", "")).toBe("> [!quote]+ [[x]]\n");
		expect(buildCallout("[[x]]", "  \n\n")).toBe("> [!quote]+ [[x]]\n");
	});
	it("본문 앞뒤 빈 줄은 잘라낸다", () => {
		expect(buildCallout("[[x]]", "\n\na\n\n")).toBe(
			"> [!quote]+ [[x]]\n> a\n",
		);
	});
	it("마크다운 형식 링크(위키링크 비활성 시)도 그대로 제목 줄에 들어간다", () => {
		expect(buildCallout("[a](b.md#c)", "본문")).toBe(
			"> [!quote]+ [a](b.md#c)\n> 본문\n",
		);
	});
	it("세 번째 인자로 콜아웃 종류를 바꾸고, 링크가 비면 제목 줄 뒤 공백이 없다", () => {
		expect(buildCallout("[[x]]", "a", "note")).toBe("> [!note]+ [[x]]\n> a\n");
		expect(buildCallout("", "a")).toBe("> [!quote]+\n> a\n");
	});
});

describe("INSERT_LABEL", () => {
	it("link/callout 두 키만 가진다", () => {
		expect(Object.keys(INSERT_LABEL).sort()).toEqual(["callout", "link"]);
	});
});
