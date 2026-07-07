import { describe, it, expect } from "vitest";
import { chunkBody } from "../src/indexer/chunker";

describe("chunkBody", () => {
	it("빈 본문은 빈 배열", () => {
		expect(chunkBody("")).toEqual([]);
		expect(chunkBody("   \n  ")).toEqual([]);
	});

	it("heading 기준으로 섹션을 나누고 heading을 보존한다", () => {
		const body = "서문 문단\n\n## 칭의란\n본문 A\n\n### 소제목\n본문 B";
		const chunks = chunkBody(body);
		expect(chunks.map((c) => c.heading)).toEqual([null, "칭의란", "소제목"]);
		expect(chunks.map((c) => c.text)).toEqual(["서문 문단", "본문 A", "본문 B"]);
		expect(chunks.map((c) => c.ord)).toEqual([0, 1, 2]);
	});

	it("heading만 있고 본문이 없는 섹션은 청크를 만들지 않는다", () => {
		const chunks = chunkBody("## 빈 섹션\n\n## 있는 섹션\n내용");
		expect(chunks).toHaveLength(1);
		expect(chunks[0].heading).toBe("있는 섹션");
	});

	it("maxChars 초과 섹션은 문단 경계에서 재분할한다", () => {
		const p1 = "가".repeat(40);
		const p2 = "나".repeat(40);
		const body = `## 긴 섹션\n${p1}\n\n${p2}`;
		const chunks = chunkBody(body, 50);
		expect(chunks).toHaveLength(2);
		expect(chunks[0].text).toBe(p1);
		expect(chunks[1].text).toBe(p2);
		expect(chunks.every((c) => c.heading === "긴 섹션")).toBe(true);
	});

	it("문단 하나가 maxChars를 넘으면 강제 분할한다", () => {
		const body = "다".repeat(120);
		const chunks = chunkBody(body, 50);
		expect(chunks.length).toBeGreaterThanOrEqual(3);
		expect(chunks.every((c) => c.text.length <= 50)).toBe(true);
		expect(chunks.map((c) => c.text).join("")).toBe(body);
	});
});
