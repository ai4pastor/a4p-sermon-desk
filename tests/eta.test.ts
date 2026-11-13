// 형태소 재계산 시간 안내 — 설정 탭 예상·진행 알림의 남은 시간 문구.
import { describe, it, expect } from "vitest";
import { formatDuration, retokenizeEstimate, remainingText } from "../src/eta";

describe("formatDuration", () => {
	it("분·시간 표기 (최소 1분)", () => {
		expect(formatDuration(0.2)).toBe("약 1분");
		expect(formatDuration(42.4)).toBe("약 42분");
		expect(formatDuration(60)).toBe("약 1시간");
		expect(formatDuration(77)).toBe("약 1시간 17분");
		expect(formatDuration(3000)).toBe("약 50시간");
	});
});

describe("retokenizeEstimate", () => {
	it("청크 수 × 청크당 시간(실측 기준)", () => {
		expect(retokenizeEstimate(50)).toBe("1분 안에 끝납니다");
		// 실측과 같은 규모: 청크 4,480개 → 옵시디언 45분
		expect(retokenizeEstimate(4480)).toBe("길게는 약 45분 걸릴 수 있습니다");
		expect(retokenizeEstimate(7698)).toBe(
			"길게는 약 1시간 17분 걸릴 수 있습니다",
		);
	});
});

describe("remainingText", () => {
	it("처리 50개 전이거나 남은 게 없으면 추정하지 않는다", () => {
		expect(remainingText(49, 10_000, 1000)).toBeNull();
		expect(remainingText(100, 10_000, 0)).toBeNull();
	});

	it("이번 실행의 처리 속도로 남은 시간", () => {
		// 100개에 60초 → 남은 1,000개는 600초
		expect(remainingText(100, 60_000, 1000)).toBe("약 10분 남음");
		expect(remainingText(100, 1_000, 50)).toBe("곧 끝남");
	});
});
