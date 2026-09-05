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
	getActiveProfile,
	scopeWeight10,
	resolveWeight10,
	makeWeightResolver,
	mirrorActiveWeights,
	foldersFingerprint,
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

	it("마이그레이션 결과에 insertMode 기본값(link)이 포함된다", () => {
		const flat = migrateToFlat({
			settingsVersion: 1,
			categories: [],
			folders: [],
		});
		expect(flat?.insertMode).toBe("link");
		const legacy = migrateLegacySettings({ folderWeights: [] });
		expect(legacy?.insertMode).toBe("link");
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

	it("insertMode — 기본 link, 무효/누락 값은 link로, callout은 유지", () => {
		expect(DEFAULT_SETTINGS.insertMode).toBe("link");
		expect(
			normalizeSettings(settingsWith({ insertMode: "bogus" as never }))
				.insertMode,
		).toBe("link");
		// 0.7.0 이전 data.json에는 필드가 없다.
		expect(
			normalizeSettings(settingsWith({ insertMode: undefined as never }))
				.insertMode,
		).toBe("link");
		expect(
			normalizeSettings(settingsWith({ insertMode: "callout" })).insertMode,
		).toBe("callout");
	});
});

describe("테마 프로파일 — v2→v3 백필", () => {
	const V2_FOLDERS = [
		{ path: "Sermons/", groupId: "internal" as const, weight: 8 },
		{ path: "Papers/", groupId: "external" as const, weight: 3 },
	];

	it("profiles가 없으면 미러 weight로 '설교'+'연구'를 생성한다", () => {
		const out = normalizeSettings(
			settingsWith({ folders: [...V2_FOLDERS] }),
		);
		expect(out.profiles.map((p) => p.name)).toEqual(["설교", "연구"]);
		expect(out.profiles[0].id).toBe("default");
		expect(out.profiles[1].id).toBe("research");
		for (const p of out.profiles) {
			expect(p.weights).toEqual({ "Sermons/": 8, "Papers/": 3 });
		}
		expect(out.activeProfileId).toBe("default");
	});

	it("profiles가 이미 있으면 백필하지 않는다 (재생성 없음)", () => {
		const out = normalizeSettings(
			settingsWith({
				folders: [...V2_FOLDERS],
				profiles: [
					{ id: "only", name: "설교", weights: { "Sermons/": 8, "Papers/": 3 } },
				],
				activeProfileId: "only",
			}),
		);
		expect(out.profiles).toHaveLength(1);
	});

	it("weights의 잉여 키는 버리고 누락 키는 미러로 백필하며 범위를 클램프한다", () => {
		const out = normalizeSettings(
			settingsWith({
				folders: [...V2_FOLDERS],
				profiles: [
					{
						id: "a",
						name: "설교",
						weights: { "Sermons/": 22, "삭제된폴더/": 5 },
					},
				],
				activeProfileId: "a",
			}),
		);
		expect(out.profiles[0].weights).toEqual({
			"Sermons/": 10, // 22 → clamp
			"Papers/": 3, // 누락 → 미러 백필
		});
	});

	it("무효한 activeProfileId는 첫 프로파일로 복구하고, 중복 id·빈 이름을 보정한다", () => {
		const out = normalizeSettings(
			settingsWith({
				folders: [...V2_FOLDERS],
				profiles: [
					{ id: "a", name: "설교", weights: {} },
					{ id: "a", name: "중복", weights: {} },
					{ id: "b", name: "  ", weights: {} },
				],
				activeProfileId: "없는id",
			}),
		);
		expect(out.profiles.map((p) => p.id)).toEqual(["a", "b"]);
		expect(out.profiles[1].name).toBe("프로파일 2");
		expect(out.activeProfileId).toBe("a");
	});

	it("normalize 후 미러 weight = 활성 프로파일 값", () => {
		const out = normalizeSettings(
			settingsWith({
				folders: [...V2_FOLDERS],
				profiles: [
					{ id: "a", name: "설교", weights: { "Sermons/": 8, "Papers/": 3 } },
					{ id: "b", name: "연구", weights: { "Sermons/": 1, "Papers/": 9 } },
				],
				activeProfileId: "b",
			}),
		);
		expect(out.folders.find((f) => f.path === "Sermons/")?.weight).toBe(1);
		expect(out.folders.find((f) => f.path === "Papers/")?.weight).toBe(9);
	});
});

describe("테마 프로파일 — 해석기", () => {
	const s = normalizeSettings(
		settingsWith({
			excludedFolders: ["Private/"],
			folders: [
				{ path: "Notes/", groupId: "internal", weight: 5 },
				{ path: "Notes/Sermons/", groupId: "internal", weight: 10 },
			],
			profiles: [
				{
					id: "sermon",
					name: "설교",
					weights: { "Notes/": 5, "Notes/Sermons/": 10 },
				},
				{
					id: "research",
					name: "연구",
					weights: { "Notes/": 7, "Notes/Sermons/": 0 },
				},
			],
			activeProfileId: "research",
		}),
	);

	it("resolveWeight10 — 활성 프로파일 값 + 최장 접두어 + 제외/미매칭 0", () => {
		expect(resolveWeight10(s, "Notes/a.md")).toBe(7);
		expect(resolveWeight10(s, "Notes/Sermons/a.md")).toBe(0); // 연구에서 0
		expect(resolveWeight10(s, "Private/a.md")).toBe(0);
		expect(resolveWeight10(s, "Elsewhere/a.md")).toBe(0);
	});

	it("makeWeightResolver — 내부 배율(×0.15)로 변환하고 메모이즈된다", () => {
		const resolve = makeWeightResolver(s);
		expect(resolve("Notes/a.md")).toBeCloseTo(7 * 0.15, 9);
		expect(resolve("Notes/a.md")).toBeCloseTo(7 * 0.15, 9);
		expect(resolve("Notes/Sermons/a.md")).toBe(0);
	});

	it("scopeWeight10 — 전 프로파일 최대값 (한쪽이 0이어도 다른 쪽이 살리면 >0)", () => {
		expect(scopeWeight10(s, "Notes/Sermons/a.md")).toBe(10); // 설교 10, 연구 0 → 10
		expect(scopeWeight10(s, "Notes/a.md")).toBe(7);
		expect(scopeWeight10(s, "Private/a.md")).toBe(0);
	});

	it("getActiveProfile — 미스매치·빈 목록에도 안전", () => {
		expect(getActiveProfile(s).id).toBe("research");
		const empty = { ...s, profiles: [], activeProfileId: "x" };
		expect(getActiveProfile(empty).weights).toEqual({});
	});

	it("mirrorActiveWeights — 같은 folders 배열을 in-place 갱신한다", () => {
		const copy = normalizeSettings(
			settingsWith({
				folders: [{ path: "A/", groupId: "internal", weight: 5 }],
				profiles: [
					{ id: "p1", name: "설교", weights: { "A/": 5 } },
					{ id: "p2", name: "연구", weights: { "A/": 9 } },
				],
				activeProfileId: "p1",
			}),
		);
		const foldersRef = copy.folders;
		copy.activeProfileId = "p2";
		mirrorActiveWeights(copy);
		expect(copy.folders).toBe(foldersRef);
		expect(copy.folders[0].weight).toBe(9);
	});
});

describe("테마 프로파일 — scope 지문", () => {
	const base = normalizeSettings(
		settingsWith({
			folders: [
				{ path: "A/", groupId: "internal", weight: 5 },
				{ path: "B/", groupId: "external", weight: 3 },
			],
		}),
	);

	it("scope가 유지되는 가중치 조정·프로파일 전환은 지문을 바꾸지 않는다", () => {
		const fp = foldersFingerprint(base);
		expect(fp.startsWith("v3|")).toBe(true);
		const tweaked = normalizeSettings(
			settingsWith({
				folders: [
					{ path: "A/", groupId: "internal", weight: 9 },
					{ path: "B/", groupId: "external", weight: 1 },
				],
			}),
		);
		expect(foldersFingerprint(tweaked)).toBe(fp);
		const switched = { ...base, activeProfileId: "research" };
		expect(foldersFingerprint(switched)).toBe(fp);
	});

	it("0↔N 전환·폴더 추가·그룹 이동·제외 변경은 지문을 바꾼다", () => {
		const fp = foldersFingerprint(base);
		const zeroed = normalizeSettings(
			settingsWith({
				folders: [
					{ path: "A/", groupId: "internal", weight: 0 },
					{ path: "B/", groupId: "external", weight: 3 },
				],
			}),
		);
		expect(foldersFingerprint(zeroed)).not.toBe(fp);
		const added = normalizeSettings(
			settingsWith({
				folders: [...base.folders, { path: "C/", groupId: "internal", weight: 5 }],
			}),
		);
		expect(foldersFingerprint(added)).not.toBe(fp);
		const regrouped = normalizeSettings(
			settingsWith({
				folders: [
					{ path: "A/", groupId: "external", weight: 5 },
					{ path: "B/", groupId: "external", weight: 3 },
				],
			}),
		);
		expect(foldersFingerprint(regrouped)).not.toBe(fp);
		const excluded = normalizeSettings(
			settingsWith({
				folders: [...base.folders],
				excludedFolders: [".trash/", "X/"],
			}),
		);
		expect(foldersFingerprint(excluded)).not.toBe(fp);
	});

	it("한 프로파일에서만 0이어도 다른 프로파일이 살리면 scope는 유지된다", () => {
		const s = normalizeSettings(
			settingsWith({
				folders: [{ path: "A/", groupId: "internal", weight: 5 }],
				profiles: [
					{ id: "p1", name: "설교", weights: { "A/": 5 } },
					{ id: "p2", name: "연구", weights: { "A/": 0 } },
				],
				activeProfileId: "p2",
			}),
		);
		const solo = normalizeSettings(
			settingsWith({
				folders: [{ path: "A/", groupId: "internal", weight: 5 }],
			}),
		);
		expect(foldersFingerprint(s)).toBe(foldersFingerprint(solo));
	});
});
