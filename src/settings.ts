export type GroupId = "internal" | "external";

export type SearchMode = "semantic" | "tag";

export interface FolderEntry {
	path: string;
	groupId: GroupId;
	/** 0~10 정수. 0 = 검색에서 제외. */
	weight: number;
}

export interface WeightedRecallSettings {
	settingsVersion: number;
	folders: FolderEntry[];
	excludedFolders: string[];
	openaiApiKey: string;
	searchMode: SearchMode;
	eagerRender: boolean;
	relevanceThreshold: number;
	doctrineRaw: string;
	doctrineKeywords: string[];
	doctrineSynonyms: Record<string, string[]>;
}

export const SETTINGS_VERSION = 2;

export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 10;
export const WEIGHT_STEP = 1;
export const DEFAULT_WEIGHT = 5;
/** UI 0~10 점수를 내부 검색 배율 0~1.5로 변환하는 계수. */
const WEIGHT_SCALE = 0.15;

export function clampWeight10(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(10, Math.round(n)));
}

/** UI 0~10 점수 → 내부 검색 배율 0~1.5 (점수식은 이 값을 그대로 곱한다). */
export function weightToInternal(uiWeight: number): number {
	return clampWeight10(uiWeight) * WEIGHT_SCALE;
}

/** 내부 검색 배율(0~1.5) → UI 0~10 점수. 검색결과 표시용. */
export function internalToWeight10(internal: number): number {
	return clampWeight10(internal / WEIGHT_SCALE);
}

function clampThreshold(v: unknown): number {
	const n = typeof v === "number" ? v : 10;
	return Math.max(0, Math.min(10, Math.round(n)));
}

export const DEFAULT_SETTINGS: WeightedRecallSettings = {
	settingsVersion: SETTINGS_VERSION,
	// 폴더는 볼트마다 다르므로 기본값은 비워 둔다. 사용자가 설정 탭에서 직접 추가한다.
	folders: [],
	excludedFolders: [".trash/"],
	openaiApiKey: "",
	searchMode: "semantic",
	eagerRender: false,
	relevanceThreshold: 10,
	doctrineRaw: "",
	doctrineKeywords: [],
	doctrineSynonyms: {},
};

export function isValidSettings(data: unknown): data is WeightedRecallSettings {
	if (!data || typeof data !== "object") return false;
	const d = data as Record<string, unknown>;
	return Array.isArray(d.folders) && Array.isArray(d.excludedFolders);
}

function normalizeSynonyms(v: unknown): Record<string, string[]> {
	if (!v || typeof v !== "object") return {};
	const out: Record<string, string[]> = {};
	for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
		if (!Array.isArray(val)) continue;
		const arr = val
			.filter((s): s is string => typeof s === "string")
			.map((s) => s.trim())
			.filter((s) => s.length >= 2);
		if (arr.length) out[k] = arr;
	}
	return out;
}

function filterStrings(v: unknown): string[] {
	return Array.isArray(v)
		? v.filter((s): s is string => typeof s === "string")
		: [];
}

/**
 * 레거시 카테고리 모델(categories[] + folders[].categoryId, weight 0~1.5)을
 * 평면 모델(folders[].groupId, weight 0~10)로 변환하는 one-shot 마이그레이션.
 * settingsVersion이 현재 버전 이상이거나 카테고리 모델이 아니면 null.
 */
export function migrateToFlat(data: unknown): WeightedRecallSettings | null {
	if (!data || typeof data !== "object") return null;
	const d = data as Record<string, unknown>;
	if (
		typeof d.settingsVersion === "number" &&
		d.settingsVersion >= SETTINGS_VERSION
	) {
		return null;
	}
	if (!Array.isArray(d.categories) || !Array.isArray(d.folders)) return null;

	const groupOf = new Map<string, GroupId>();
	for (const c of d.categories as unknown[]) {
		if (!c || typeof c !== "object") continue;
		const cat = c as Record<string, unknown>;
		const id = typeof cat.id === "string" ? cat.id : null;
		if (!id) continue;
		let gid: GroupId;
		if (cat.groupId === "internal" || cat.groupId === "external") {
			gid = cat.groupId;
		} else if (typeof cat.isExternal === "boolean") {
			gid = cat.isExternal ? "external" : "internal";
		} else {
			gid = id === "raw" ? "external" : "internal";
		}
		groupOf.set(id, gid);
	}

	const folders: FolderEntry[] = [];
	for (const f of d.folders as unknown[]) {
		if (!f || typeof f !== "object") continue;
		const fe = f as Record<string, unknown>;
		if (typeof fe.path !== "string") continue;
		const catId = typeof fe.categoryId === "string" ? fe.categoryId : "";
		const gid = groupOf.get(catId);
		if (gid === undefined) {
			console.warn(
				`[a4p-sermon-desk] migrateToFlat: 알 수 없는 categoryId "${catId}" (${fe.path}) → internal`,
			);
		}
		const oldWeight = typeof fe.weight === "number" ? fe.weight : 0.75;
		folders.push({
			path: fe.path,
			groupId: gid ?? "internal",
			weight: clampWeight10(oldWeight / WEIGHT_SCALE),
		});
	}

	return {
		settingsVersion: SETTINGS_VERSION,
		folders,
		excludedFolders: Array.isArray(d.excludedFolders)
			? filterStrings(d.excludedFolders)
			: [...DEFAULT_SETTINGS.excludedFolders],
		openaiApiKey: typeof d.openaiApiKey === "string" ? d.openaiApiKey : "",
		searchMode: d.searchMode === "tag" ? "tag" : "semantic",
		eagerRender: typeof d.eagerRender === "boolean" ? d.eagerRender : false,
		relevanceThreshold: clampThreshold(d.relevanceThreshold),
		doctrineRaw: typeof d.doctrineRaw === "string" ? d.doctrineRaw : "",
		doctrineKeywords: filterStrings(d.doctrineKeywords),
		doctrineSynonyms: normalizeSynonyms(d.doctrineSynonyms),
	};
}

/**
 * 초레거시 folderWeights 형식(평면, weight 0~1.5)을 새 모델로 변환.
 */
export function migrateLegacySettings(
	data: unknown,
): WeightedRecallSettings | null {
	if (!data || typeof data !== "object") return null;
	const d = data as Record<string, unknown>;
	if (!Array.isArray(d.folderWeights)) return null;

	const folders: FolderEntry[] = [];
	for (const item of d.folderWeights) {
		if (!item || typeof item !== "object") continue;
		const f = item as Record<string, unknown>;
		if (typeof f.path !== "string" || typeof f.weight !== "number") continue;
		folders.push({
			path: f.path,
			groupId: "internal",
			weight: clampWeight10(f.weight / WEIGHT_SCALE),
		});
	}

	return {
		settingsVersion: SETTINGS_VERSION,
		folders,
		excludedFolders: Array.isArray(d.excludedFolders)
			? filterStrings(d.excludedFolders)
			: [...DEFAULT_SETTINGS.excludedFolders],
		openaiApiKey: typeof d.openaiApiKey === "string" ? d.openaiApiKey : "",
		searchMode: "semantic",
		eagerRender: false,
		relevanceThreshold: 10,
		doctrineRaw: "",
		doctrineKeywords: [],
		doctrineSynonyms: {},
	};
}

export function parseDoctrineRaw(raw: string): string[] {
	const set = new Set<string>();
	const emojiRe =
		/^[\p{Extended_Pictographic}\p{Emoji_Component}︀-️‍]+/gu;
	const clean = (s: string): string => {
		let kw = s.trim();
		const pipeIdx = kw.indexOf("|");
		if (pipeIdx >= 0) kw = kw.slice(0, pipeIdx).trim();
		return kw.replace(emojiRe, "").trim();
	};
	let m: RegExpExecArray | null;
	// [[키워드]] 위키링크 형식
	const reLink = /\[\[([^\]]+)\]\]/g;
	while ((m = reLink.exec(raw)) !== null) {
		const kw = clean(m[1]);
		if (kw) set.add(kw);
	}
	// "키워드" 큰따옴표 형식 (일반 " + 스마트 " "). 작은따옴표는 본문 오인식 위험으로 제외.
	const reQuote = /["“”]([^"“”\n]+)["“”]/g;
	while ((m = reQuote.exec(raw)) !== null) {
		const kw = clean(m[1]);
		if (kw) set.add(kw);
	}
	return [...set];
}

/** clamp/sanitize 전용. 마이그레이션은 하지 않는다(migrateToFlat이 담당). */
export function normalizeSettings(
	settings: WeightedRecallSettings,
): WeightedRecallSettings {
	const folders: FolderEntry[] = Array.isArray(settings.folders)
		? settings.folders
				.filter(
					(f): f is FolderEntry =>
						!!f && typeof f.path === "string",
				)
				.map((f) => ({
					path: f.path,
					groupId:
						f.groupId === "external" ? "external" : "internal",
					weight: clampWeight10(f.weight),
				}))
		: [];
	return {
		settingsVersion: SETTINGS_VERSION,
		folders,
		excludedFolders: filterStrings(settings.excludedFolders),
		openaiApiKey:
			typeof settings.openaiApiKey === "string"
				? settings.openaiApiKey
				: "",
		searchMode: settings.searchMode === "tag" ? "tag" : "semantic",
		eagerRender:
			typeof settings.eagerRender === "boolean"
				? settings.eagerRender
				: false,
		relevanceThreshold: clampThreshold(settings.relevanceThreshold),
		doctrineRaw:
			typeof settings.doctrineRaw === "string"
				? settings.doctrineRaw
				: "",
		doctrineKeywords: filterStrings(settings.doctrineKeywords),
		doctrineSynonyms: normalizeSynonyms(settings.doctrineSynonyms),
	};
}

export function isPathExcluded(
	settings: WeightedRecallSettings,
	path: string,
): boolean {
	return settings.excludedFolders.some((excl) => path.startsWith(excl));
}

/** path를 prefix로 갖는 폴더 중 가장 긴(가장 구체적인) 폴더를 반환. */
export function longestPrefixFolder(
	settings: WeightedRecallSettings,
	path: string,
): FolderEntry | undefined {
	let best: FolderEntry | undefined;
	for (const f of settings.folders) {
		if (
			path.startsWith(f.path) &&
			(!best || f.path.length > best.path.length)
		) {
			best = f;
		}
	}
	return best;
}

export function getFolderWeight(
	settings: WeightedRecallSettings,
	path: string,
): number | null {
	if (isPathExcluded(settings, path)) return null;
	const entry = longestPrefixFolder(settings, path);
	if (!entry || entry.weight === 0) return null;
	return weightToInternal(entry.weight);
}

/** 폴더 설정의 지문 — 인덱스(DB)가 현재 설정과 동기화됐는지 판별용. */
export function foldersFingerprint(settings: WeightedRecallSettings): string {
	const f = settings.folders
		.map((x) => `${x.path}|${x.groupId}|${x.weight}`)
		.sort()
		.join(";");
	const e = settings.excludedFolders.slice().sort().join(";");
	return `${f}||${e}`;
}
