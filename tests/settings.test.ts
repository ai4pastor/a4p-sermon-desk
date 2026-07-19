import { describe, it, expect } from "vitest";
import {
	DEFAULT_SETTINGS,
	DEFAULT_CHAT_MODEL,
	DEFAULT_CHAT_TOP_K,
	clampChatTopK,
	clampWeight10,
	weightToInternal,
	internalToWeight10,
	parseDoctrineRaw,
	migrateToFlat,
	migrateLegacySettings,
	normalizeSettings,
	isUnderFolder,
	isPathExcluded,
	longestPrefixFolder,
	getFolderWeight,
	type WeightedRecallSettings,
} from "../src/settings";

function settingsWith(
	partial: Partial<WeightedRecallSettings>,
): WeightedRecallSettings {
	return { ...DEFAULT_SETTINGS, ...partial };
}

describe("clampWeight10 / weight 변환", () => {
	it("0~10 정수로 클램프한다", () => {
		expect(clampWeight10(-3)).toBe(0);
		expect(clampWeight10(11)).toBe(10);
		expect(clampWeight10(5.6)).toBe(6);
		expect(clampWeight10(NaN)).toBe(0);
		expect(clampWeight10(Infinity)).toBe(0);
	});

	it("UI 점수 ↔ 내부 배율 왕복이 보존된다", () => {
		for (let w = 0; w <= 10; w++) {
			expect(internalToWeight10(weightToInternal(w))).toBe(w);
		}
		expect(weightToInternal(10)).toBeCloseTo(1.5);
	});
});

describe("isUnderFolder — 폴더 경계 매칭", () => {
	it("트레일링 슬래시가 없어도 형제 폴더에 오매칭되지 않는다", () => {
		expect(isUnderFolder("Sermons2/a.md", "Ser")).toBe(false);
		expect(isUnderFolder("Sermons2/a.md", "Sermons")).toBe(false);
		expect(isUnderFolder("Sermons/a.md", "Sermons")).toBe(true);
	});

	it("트레일링 슬래시 유무와 무관하게 하위 경로를 매칭한다", () => {
		expect(isUnderFolder("A/B/c.md", "A/")).toBe(true);
		expect(isUnderFolder("A/B/c.md", "A")).toBe(true);
		expect(isUnderFolder("A/B/c.md", "A/B/")).toBe(true);
		expect(isUnderFolder("A2/c.md", "A/")).toBe(false);
	});

	it("빈 폴더 문자열은 아무것도 매칭하지 않는다", () => {
		expect(isUnderFolder("A/b.md", "")).toBe(false);
	});
});

describe("isPathExcluded / longestPrefixFolder / getFolderWeight", () => {
	const s = settingsWith({
		excludedFolders: [".trash/", "Private"],
		folders: [
			{ path: "Notes/", groupId: "internal", weight: 5 },
			{ path: "Notes/Sermons/", groupId: "internal", weight: 10 },
			{ path: "External/", groupId: "external", weight: 3 },
		],
	});

	it("제외 폴더를 경계 기준으로 판정한다", () => {
		expect(isPathExcluded(s, ".trash/x.md")).toBe(true);
		expect(isPathExcluded(s, "Private/x.md")).toBe(true);
		expect(isPathExcluded(s, "Private2/x.md")).toBe(false);
	});

	it("가장 구체적인(긴) 폴더를 고른다", () => {
		expect(longestPrefixFolder(s, "Notes/Sermons/a.md")?.weight).toBe(10);
		expect(longestPrefixFolder(s, "Notes/a.md")?.weight).toBe(5);
		expect(longestPrefixFolder(s, "Elsewhere/a.md")).toBeUndefined();
	});

	it("weight 0 폴더·제외 경로는 null을 반환한다", () => {
		const z = settingsWith({
			folders: [{ path: "Zero/", groupId: "internal", weight: 0 }],
			excludedFolders: ["X/"],
		});
		expect(getFolderWeight(z, "Zero/a.md")).toBeNull();
		expect(getFolderWeight(z, "X/a.md")).toBeNull();
	});
});

describe("parseDoctrineRaw", () => {
	it("위키링크·큰따옴표 형식을 인식하고 이모지/별칭을 제거한다", () => {
		const raw = '- [[🔖 칭의|의롭다하심]]\n- "성화"\n- [[구원]]';
		const keys = parseDoctrineRaw(raw);
		expect(keys).toContain("칭의");
		expect(keys).toContain("성화");
		expect(keys).toContain("구원");
	});

	it("작은따옴표는 인식하지 않는다", () => {
		expect(parseDoctrineRaw("'회개'")).toEqual([]);
	});
});

describe("마이그레이션", () => {
	it("migrateToFlat — 카테고리 모델을 평면 모델로 변환한다", () => {
		const legacy = {
			settingsVersion: 1,
			categories: [
				{ id: "sermon", isExternal: false },
				{ id: "raw", isExternal: true },
			],
			folders: [
				{ path: "Sermons/", categoryId: "sermon", weight: 0.75 },
				{ path: "Raw/", categoryId: "raw", weight: 1.5 },
			],
			excludedFolders: [".trash/"],
			openaiApiKey: "k",
		};
		const flat = migrateToFlat(legacy);
		expect(flat).not.toBeNull();
		expect(flat?.folders).toEqual([
			{ path: "Sermons/", groupId: "internal", weight: 5 },
			{ path: "Raw/", groupId: "external", weight: 10 },
		]);
		expect(flat?.autoSearch).toBe(false);
		expect(flat?.openaiApiKey).toBe("k");
	});

	it("migrateToFlat — 현재 버전 데이터는 null", () => {
		expect(migrateToFlat({ settingsVersion: 2, folders: [] })).toBeNull();
	});

	it("migrateLegacySettings — folderWeights 형식을 변환한다", () => {
		const legacy = {
			folderWeights: [{ path: "A/", weight: 0.75 }],
		};
		const out = migrateLegacySettings(legacy);
		expect(out?.folders).toEqual([
			{ path: "A/", groupId: "internal", weight: 5 },
		]);
		expect(out?.autoSearch).toBe(false);
	});

	it("마이그레이션 결과에 chatModel 기본값이 포함된다", () => {
		const flat = migrateToFlat({
			settingsVersion: 1,
			categories: [],
			folders: [],
		});
		expect(flat?.chatModel).toBe(DEFAULT_CHAT_MODEL);
		const legacy = migrateLegacySettings({ folderWeights: [] });
		expect(legacy?.chatModel).toBe(DEFAULT_CHAT_MODEL);
	});
});

describe("normalizeSettings", () => {
	it("잘못된 값을 기본값으로 보정하고 autoSearch를 boolean으로 강제한다", () => {
		const messy = {
			...DEFAULT_SETTINGS,
			relevanceThreshold: 99,
			autoSearch: "yes" as unknown as boolean,
			folders: [
				{ path: "A/", groupId: "external", weight: 22 },
				null as never,
			],
		};
		const out = normalizeSettings(messy);
		expect(out.relevanceThreshold).toBe(10);
		expect(out.autoSearch).toBe(false);
		expect(out.folders).toEqual([
			{ path: "A/", groupId: "external", weight: 10 },
		]);
	});

	it("chatTopK를 3~20 정수로 클램프한다", () => {
		expect(clampChatTopK(1)).toBe(3);
		expect(clampChatTopK(99)).toBe(20);
		expect(clampChatTopK(12.6)).toBe(13);
		expect(clampChatTopK(undefined)).toBe(DEFAULT_CHAT_TOP_K);
		expect(clampChatTopK(NaN)).toBe(DEFAULT_CHAT_TOP_K);
		const out = normalizeSettings(
			settingsWith({ chatTopK: 999 as never }),
		);
		expect(out.chatTopK).toBe(20);
	});

	it("유효하지 않은 chatModel은 기본값으로 보정한다", () => {
		const out = normalizeSettings(
			settingsWith({ chatModel: "gpt-99" as never }),
		);
		expect(out.chatModel).toBe(DEFAULT_CHAT_MODEL);
		const ok = normalizeSettings(settingsWith({ chatModel: "gpt-4o-mini" }));
		expect(ok.chatModel).toBe("gpt-4o-mini");
	});
});
