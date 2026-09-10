// 형태소 보호 단어 — 순수 규칙 테스트 (wasm 없음).
import { describe, it, expect } from "vitest";
import {
	countOccurrences,
	deriveProtectedTerms,
	normalizeProtectedTerm,
	parseProtectedInput,
	protectedFingerprint,
	topUpProtected,
} from "../src/morpheme/protected";

describe("normalizeProtectedTerm / parseProtectedInput", () => {
	it("공백 포함·1글자·불용어·빈 값은 제외, 이모지 제거, 비한글은 소문자", () => {
		expect(normalizeProtectedTerm("거룩")).toBe("거룩");
		expect(normalizeProtectedTerm(" ✝️ 성화 ")).toBe("성화");
		expect(normalizeProtectedTerm("거룩한 삶")).toBeNull(); // 내부 공백
		expect(normalizeProtectedTerm("주")).toBeNull(); // 1글자
		expect(normalizeProtectedTerm("하나님")).toBeNull(); // 불용어
		expect(normalizeProtectedTerm("")).toBeNull();
		expect(normalizeProtectedTerm("AI")).toBe("ai");
		// NFD → NFC
		expect(normalizeProtectedTerm("거룩".normalize("NFD"))).toBe("거룩");
	});

	it("줄바꿈·쉼표 구분 입력을 정렬된 고유 목록으로", () => {
		expect(parseProtectedInput("성화, 거룩\n칭의,,거룩\n")).toEqual([
			"거룩",
			"성화",
			"칭의",
		]);
	});
});

describe("deriveProtectedTerms", () => {
	it("교리 키워드 ∪ 동의어(단어형) ∪ 직접 추가, 구 형태 동의어는 제외", () => {
		// 두 어휘 사전의 합집합 — 렉시콘이 몇 개든 chunk_terms는 하나(색인·쿼리 공통).
		const terms = deriveProtectedTerms({
			lexicons: [
				{ keywords: ["칭의", "주"], synonyms: { 칭의: ["의롭다 하심", "의롭"] } },
				{ keywords: ["성화"], synonyms: { 성화: ["거룩", "거룩해짐", "거룩한 삶"] } },
			],
			protectedTerms: ["회개", "칭의"],
		});
		expect(terms).toEqual(["거룩", "거룩해짐", "성화", "의롭", "칭의", "회개"]);
	});
});

describe("countOccurrences / topUpProtected", () => {
	it("비중첩 등장 횟수", () => {
		expect(countOccurrences("거룩 거룩 거룩해지는", "거룩")).toBe(3);
		expect(countOccurrences("아무것도", "거룩")).toBe(0);
		expect(countOccurrences("AI 시대 ai", "ai")).toBe(2);
	});

	it("garu가 놓친 보호어만 부족분만큼 추가, 이미 있으면 중복 없음", () => {
		// "거룩해지는 삶" → garu [해지]
		expect(topUpProtected(["해지"], "거룩해지는 삶", ["거룩", "성화"])).toEqual([
			"해지",
			"거룩",
		]);
		// garu가 이미 "칭의"를 1개 뽑았고 본문에 1회 → 추가 0
		expect(topUpProtected(["칭의", "믿음"], "칭의와 믿음", ["칭의"])).toEqual([
			"칭의",
			"믿음",
		]);
		// 본문 2회, 토큰 1개 → 1개 보충
		expect(topUpProtected(["칭의"], "칭의, 그리고 칭의", ["칭의"])).toEqual([
			"칭의",
			"칭의",
		]);
		// 보호어 없음/빈 텍스트 → 입력 복사
		expect(topUpProtected(["a"], "a", [])).toEqual(["a"]);
		expect(topUpProtected(["a"], "", ["a"])).toEqual(["a"]);
	});
});

describe("protectedFingerprint", () => {
	it("순서 무관·내용 민감", () => {
		expect(protectedFingerprint(["a", "b"])).toBe(protectedFingerprint(["b", "a"]));
		expect(protectedFingerprint(["a", "b"])).not.toBe(protectedFingerprint(["a", "c"]));
		expect(protectedFingerprint([])).toMatch(/^0:/);
	});
});
