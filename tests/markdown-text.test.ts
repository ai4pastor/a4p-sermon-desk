// 검색 결과 표시용 평문 투영 — 설치본 인덱스에서 실제로 많이 나오는 패턴 기준.
import { describe, it, expect } from "vitest";
import {
	stripTagPrefix,
	parseTagPrefix,
	stripInlineMarkdown,
	toPlainText,
	makeSnippet,
	buildTermRegex,
	splitByTerms,
	LINE_JOINER,
} from "../src/markdown-text";

describe("stripTagPrefix / parseTagPrefix", () => {
	it("앞의 [태그: …] 접두만 제거한다", () => {
		expect(stripTagPrefix("[태그: a, b] 본문")).toBe("본문");
		expect(stripTagPrefix("본문")).toBe("본문");
		expect(stripTagPrefix("본문 [태그: x]")).toBe("본문 [태그: x]");
	});
	it("태그 목록을 파싱한다 (공백·중복 정리, 없으면 [])", () => {
		expect(parseTagPrefix("[태그: 감사,  기도, 감사] 본문")).toEqual(["감사", "기도"]);
		expect(parseTagPrefix("본문")).toEqual([]);
		expect(parseTagPrefix("[태그: ] 본문")).toEqual([]);
	});
});

describe("stripInlineMarkdown", () => {
	const cases: [string, string][] = [
		["**굳센** _믿음_", "굳센 믿음"],
		["==강조== ~~취소~~", "강조 취소"],
		["[[100/칭의#정의|칭의란]]", "칭의란"],
		["[[100/칭의#정의]]", "칭의"],
		["[[#정의]]", "정의"],
		["[본문](https://x)", "본문"],
		["[**a**](u)", "a"],
		["![[img.png]] 뒤", "뒤"],
		['<span class="x">밑줄</span><sup>1</sup>', "밑줄1"],
		["`code`", "code"],
		["**0:16** · 말씀", "0:16 · 말씀"],
		["[Full Document…|See →]", "[Full Document…|See →]"],
		["📌 ✝️", "📌 ✝️"],
		["snake_case", "snake_case"],
		["a < b", "a < b"],
		["각주[^1] 끝", "각주 끝"],
		["줄<br>바꿈", "줄 바꿈"],
	];
	for (const [input, expected] of cases) {
		it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
			expect(stripInlineMarkdown(input)).toBe(expected);
		});
	}
});

describe("toPlainText", () => {
	const cases: [string, string, string][] = [
		["글머리표·체크박스", "- 첫째\n- 둘째\n- [ ] 셋째", "첫째\n둘째\n셋째"],
		["콜아웃 헤더는 제목만", "> [!quote] 핵심\n> 본문", "핵심\n본문"],
		[
			"콜아웃 제목 안의 링크",
			"> [!info] 원영상 구간 [11:17 – 23:21](u) · 허브: [[a|b]]\n> x",
			"원영상 구간 11:17 – 23:21 · 허브: b\nx",
		],
		["제목 없는 콜아웃은 헤더 삭제", "> [!note]\n> 본문", "본문"],
		["구분선 삭제", "---\n본문\n---", "본문"],
		["표", "|a|b|\n|---|---|\n|1|2|", `a${LINE_JOINER}b\n1${LINE_JOINER}2`],
		["번호 목록", "1. 하나\n2) 둘", "하나\n둘"],
		["중첩 인용", "> > 중첩", "중첩"],
		["헤딩", "## 제목\n본문", "제목\n본문"],
		["태그 접두 제거", "[태그: a, b] - **첫** 줄\n- 둘", "첫 줄\n둘"],
		["펜스 줄 삭제·코드 본문 유지", "```js\nlet a = 1;\n```", "let a = 1;"],
		["마커만 있는 빈 목록 항목 삭제", "-\n- 본문\n1.\n* ", "본문"],
		["CRLF", "가\r\n나", "가\n나"],
	];
	for (const [name, input, expected] of cases) {
		it(name, () => {
			expect(toPlainText(input)).toBe(expected);
		});
	}
});

describe("makeSnippet", () => {
	const filler = "가나다라마바사아자차카타파하 ".repeat(30); // 450자
	it("검색어가 중간에 있으면 그 부근을 …로 시작해 보여 준다", () => {
		const text = `${filler}칭의는 은혜다 ${filler}`;
		const s = makeSnippet(text, ["칭의"]);
		expect(s.startsWith("…")).toBe(true);
		expect(s).toContain("칭의");
		expect(s.length).toBeLessThanOrEqual(160 + 2);
	});
	it("검색어가 없으면 앞 160자(선행 … 없음, 후행 … 있음)", () => {
		const s = makeSnippet(filler, ["없는단어"]);
		expect(s.startsWith("…")).toBe(false);
		expect(s.endsWith("…")).toBe(true);
		expect(s.length).toBe(161);
	});
	it("짧은 본문은 …가 붙지 않고 기호가 제거된다", () => {
		expect(makeSnippet("[태그: x] **짧은** [[본문|글]]", [])).toBe("짧은 글");
	});
	it("줄바꿈은 LINE_JOINER로", () => {
		expect(makeSnippet("- 첫째\n- 둘째", [])).toBe(`첫째${LINE_JOINER}둘째`);
	});
	it("불용어만인 검색어는 폴백(앞부분)", () => {
		const text = `${filler}하나님 ${filler}`;
		expect(makeSnippet(text, ["하나님"]).startsWith("…")).toBe(false);
	});
	it("이모지를 반으로 자르지 않는다", () => {
		const s = makeSnippet("😀".repeat(200), [], 161);
		expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s)).toBe(false);
		expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)).toBe(false);
	});
	it("빈 본문 → 빈 문자열", () => {
		expect(makeSnippet("", ["a"])).toBe("");
	});
});

describe("buildTermRegex / splitByTerms", () => {
	it("빈 배열·1글자·불용어만이면 null", () => {
		expect(buildTermRegex([])).toBeNull();
		expect(buildTermRegex(["a"])).toBeNull();
		expect(buildTermRegex(["하나님"])).toBeNull();
	});
	it("긴 검색어 우선·대소문자 무시·특수문자 이스케이프", () => {
		const re = buildTermRegex(["칭의", "칭의론", "a+b"])!;
		expect(re.source.startsWith("(칭의론|")).toBe(true);
		expect(splitByTerms("칭의론과 칭의, A+B", re)).toEqual([
			{ text: "칭의론", hit: true },
			{ text: "과 ", hit: false },
			{ text: "칭의", hit: true },
			{ text: ", ", hit: false },
			{ text: "A+B", hit: true },
		]);
	});
	it("일치가 없으면 통째로 한 조각", () => {
		const re = buildTermRegex(["칭의"])!;
		expect(splitByTerms("성화", re)).toEqual([{ text: "성화", hit: false }]);
	});
});
