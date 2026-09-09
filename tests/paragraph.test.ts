import { describe, it, expect } from "vitest";
import { paragraphAround } from "../src/paragraph";

describe("paragraphAround", () => {
	const doc = [
		"# 제목",
		"",
		"첫 문단 첫 줄",
		"첫 문단 둘째 줄",
		"",
		"   ",
		"둘째 문단",
		"",
	];

	it("빈 줄(공백만 있는 줄 포함)을 경계로 커서 문단을 뽑는다", () => {
		expect(paragraphAround(doc, 2)).toBe("첫 문단 첫 줄\n첫 문단 둘째 줄");
		expect(paragraphAround(doc, 3)).toBe("첫 문단 첫 줄\n첫 문단 둘째 줄");
		expect(paragraphAround(doc, 6)).toBe("둘째 문단");
		expect(paragraphAround(doc, 0)).toBe("# 제목");
	});

	it("커서가 빈 줄에 있으면 빈 문자열", () => {
		expect(paragraphAround(doc, 1)).toBe("");
		expect(paragraphAround(doc, 5)).toBe("");
	});

	it("범위 밖 줄 번호는 클램프, 빈 문서는 빈 문자열", () => {
		expect(paragraphAround(doc, 99)).toBe("");
		expect(paragraphAround(doc, -5)).toBe("# 제목");
		expect(paragraphAround([], 0)).toBe("");
	});
});
