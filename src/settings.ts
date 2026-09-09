export type GroupId = "internal" | "external";

export type SearchMode = "semantic" | "tag";

/** 검색 결과를 노트에 넣는 방식 — 드래그·카드 버튼·팝업 버튼 공통. */
export type InsertMode = "link" | "callout";

export const CHAT_MODELS = [
	"gpt-5-mini",
	"gpt-4o-mini",
	"gpt-4.1-mini",
] as const;
export type ChatModel = (typeof CHAT_MODELS)[number];
export const DEFAULT_CHAT_MODEL: ChatModel = "gpt-5-mini";

function normalizeChatModel(v: unknown): ChatModel {
	return CHAT_MODELS.includes(v as ChatModel)
		? (v as ChatModel)
		: DEFAULT_CHAT_MODEL;
}

export const CHAT_TOP_K_MIN = 3;
export const CHAT_TOP_K_MAX = 20;
export const DEFAULT_CHAT_TOP_K = 15;

/** 검색 결과 카드 개수(의미·태그 공통). 패널 '결과' 칩·설정 탭에서 선택. */
export const RESULT_COUNTS = [10, 20, 50] as const;
export type ResultCount = (typeof RESULT_COUNTS)[number];
export const DEFAULT_RESULT_COUNT: ResultCount = 10;

export function normalizeResultCount(v: unknown): ResultCount {
	return (RESULT_COUNTS as readonly number[]).includes(v as number)
		? (v as ResultCount)
		: DEFAULT_RESULT_COUNT;
}

export function clampChatTopK(v: unknown): number {
	const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_CHAT_TOP_K;
	return Math.max(CHAT_TOP_K_MIN, Math.min(CHAT_TOP_K_MAX, n));
}

export interface FolderEntry {
	path: string;
	groupId: GroupId;
	/**
	 * 0~10 정수. 0 = 검색에서 제외.
	 * v3부터는 "활성 프로파일 가중치의 미러"다 — 색인·검색의 실제 가중치는
	 * profiles가 결정하고, 이 필드는 구버전(≤0.5.x) 호환·롤백용으로 유지된다.
	 * saveSettings 경로의 mirrorActiveWeights()가 동기화를 담당한다.
	 */
	weight: number;
}

/** 테마별 폴더 가중치 세트. 폴더 목록(path/groupId)은 전 프로파일 공유. */
export interface WeightProfile {
	id: string;
	name: string;
	/** 폴더 path → 0~10 정수. normalizeSettings가 folders 전체 커버를 보장. */
	weights: Record<string, number>;
}

export interface WeightedRecallSettings {
	settingsVersion: number;
	folders: FolderEntry[];
	/** 테마 프로파일 목록. normalizeSettings가 최소 1개를 보장. */
	profiles: WeightProfile[];
	/** 현재 사용 중인 프로파일 id. normalizeSettings가 유효성을 보장. */
	activeProfileId: string;
	excludedFolders: string[];
	openaiApiKey: string;
	searchMode: SearchMode;
	/** 링크만 넣을지, 매칭 문단을 콜아웃으로 넣을지. Option(Alt)으로 1회 반전. */
	insertMode: InsertMode;
	/** 채팅 탭(노트 기반 Q&A)에 사용할 OpenAI 모델. */
	chatModel: ChatModel;
	/** 채팅 답변 시 참고할 자료(청크) 최대 개수. 3~20. */
	chatTopK: number;
	/** true면 편집·선택 시 실시간 자동 검색. false(기본)면 우클릭 메뉴 등 수동 트리거만. */
	autoSearch: boolean;
	eagerRender: boolean;
	/** 🔬 분석 — 결과 카드에 점수 구성(어휘·의미·가중치)과 "왜 이 결과?" 근거 표시. */
	showAnalysis: boolean;
	/** 검색 결과 카드 개수(10/20/50). 채팅 참고 자료 수(chatTopK)와는 별개. */
	resultCount: ResultCount;
	/** 형태소 보호 단어(직접 추가분). 교리 키워드·동의어는 자동 포함. */
	protectedTerms: string[];
	relevanceThreshold: number;
	doctrineRaw: string;
	doctrineKeywords: string[];
	doctrineSynonyms: Record<string, string[]>;
}

export const SETTINGS_VERSION = 3;

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
	// 비워 두면 normalizeSettings가 "설교"+"연구" 기본 프로파일을 백필한다.
	profiles: [],
	activeProfileId: "",
	excludedFolders: [".trash/"],
	openaiApiKey: "",
	searchMode: "semantic",
	insertMode: "link",
	chatModel: DEFAULT_CHAT_MODEL,
	chatTopK: DEFAULT_CHAT_TOP_K,
	autoSearch: false,
	eagerRender: false,
	showAnalysis: false,
	resultCount: DEFAULT_RESULT_COUNT,
	protectedTerms: [],
	relevanceThreshold: 10,
	doctrineRaw: "",
	doctrineKeywords: [],
	doctrineSynonyms: {},
};

export function isValidSettings(data: unknown): data is WeightedRecallSettings {
	if (!data || typeof data !== "object") return false;
	const d = data as Record<string, unknown>;
	// 의도적으로 관용적: profiles 없는 v2 데이터도 유효 판정 → merge 경로로 들어와
	// normalizeSettings가 프로파일을 백필한다(무중단 마이그레이션).
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
		profiles: [],
		activeProfileId: "",
		excludedFolders: Array.isArray(d.excludedFolders)
			? filterStrings(d.excludedFolders)
			: [...DEFAULT_SETTINGS.excludedFolders],
		openaiApiKey: typeof d.openaiApiKey === "string" ? d.openaiApiKey : "",
		searchMode: d.searchMode === "tag" ? "tag" : "semantic",
		insertMode: "link",
		chatModel: normalizeChatModel(d.chatModel),
		chatTopK: clampChatTopK(d.chatTopK),
		autoSearch: d.autoSearch === true,
		eagerRender: typeof d.eagerRender === "boolean" ? d.eagerRender : false,
		showAnalysis: false,
		resultCount: DEFAULT_RESULT_COUNT,
		protectedTerms: [],
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
		profiles: [],
		activeProfileId: "",
		excludedFolders: Array.isArray(d.excludedFolders)
			? filterStrings(d.excludedFolders)
			: [...DEFAULT_SETTINGS.excludedFolders],
		openaiApiKey: typeof d.openaiApiKey === "string" ? d.openaiApiKey : "",
		searchMode: "semantic",
		insertMode: "link",
		chatModel: DEFAULT_CHAT_MODEL,
		chatTopK: DEFAULT_CHAT_TOP_K,
		autoSearch: false,
		eagerRender: false,
		showAnalysis: false,
		resultCount: DEFAULT_RESULT_COUNT,
		protectedTerms: [],
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

/**
 * clamp/sanitize + 프로파일 불변식 보장. 모든 로드 경로의 단일 관문.
 * (구조 변환 마이그레이션은 migrateToFlat/migrateLegacySettings가 담당하고,
 *  v2 → v3 프로파일 백필은 여기서 일어난다: profiles가 비어 있으면
 *  folders의 미러 weight로 "설교" + 복제본 "연구"를 생성.)
 */
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

	const rawProfiles: unknown[] = Array.isArray(settings.profiles)
		? settings.profiles
		: [];
	const seenIds = new Set<string>();
	const profiles: WeightProfile[] = [];
	for (const raw of rawProfiles) {
		if (!raw || typeof raw !== "object") continue;
		const p = raw as Record<string, unknown>;
		if (typeof p.id !== "string" || !p.id || seenIds.has(p.id)) continue;
		const name =
			typeof p.name === "string" && p.name.trim()
				? p.name.trim()
				: `프로파일 ${profiles.length + 1}`;
		const rawW =
			p.weights && typeof p.weights === "object"
				? (p.weights as Record<string, unknown>)
				: {};
		// folders 전체를 커버하도록 백필(누락 키는 미러 weight), folders에 없는 키는 버림.
		const weights: Record<string, number> = {};
		for (const f of folders) {
			const w = rawW[f.path];
			weights[f.path] =
				typeof w === "number" && Number.isFinite(w)
					? clampWeight10(w)
					: f.weight;
		}
		seenIds.add(p.id);
		profiles.push({ id: p.id, name, weights });
	}
	if (profiles.length === 0) {
		const base: Record<string, number> = {};
		for (const f of folders) base[f.path] = f.weight;
		// 고정 id — 백필이 반복 실행돼도 결정적이도록.
		profiles.push({ id: "default", name: "설교", weights: { ...base } });
		profiles.push({ id: "research", name: "연구", weights: { ...base } });
	}
	const activeProfileId = profiles.some(
		(p) => p.id === settings.activeProfileId,
	)
		? settings.activeProfileId
		: profiles[0].id;

	const result: WeightedRecallSettings = {
		settingsVersion: SETTINGS_VERSION,
		folders,
		profiles,
		activeProfileId,
		excludedFolders: filterStrings(settings.excludedFolders),
		openaiApiKey:
			typeof settings.openaiApiKey === "string"
				? settings.openaiApiKey
				: "",
		searchMode: settings.searchMode === "tag" ? "tag" : "semantic",
		insertMode: settings.insertMode === "callout" ? "callout" : "link",
		chatModel: normalizeChatModel(settings.chatModel),
		chatTopK: clampChatTopK(settings.chatTopK),
		autoSearch: settings.autoSearch === true,
		eagerRender:
			typeof settings.eagerRender === "boolean"
				? settings.eagerRender
				: false,
		showAnalysis: settings.showAnalysis === true,
		resultCount: normalizeResultCount(settings.resultCount),
		protectedTerms: filterStrings(settings.protectedTerms),
		relevanceThreshold: clampThreshold(settings.relevanceThreshold),
		doctrineRaw:
			typeof settings.doctrineRaw === "string"
				? settings.doctrineRaw
				: "",
		doctrineKeywords: filterStrings(settings.doctrineKeywords),
		doctrineSynonyms: normalizeSynonyms(settings.doctrineSynonyms),
	};
	mirrorActiveWeights(result);
	return result;
}

/** 폴더 경계를 존중하는 prefix 매칭 — "Ser"이 "Sermons2/…"에 오매칭되지 않게. */
export function isUnderFolder(path: string, folder: string): boolean {
	if (folder.length === 0) return false;
	const prefix = folder.endsWith("/") ? folder : `${folder}/`;
	return path === folder || path.startsWith(prefix);
}

export function isPathExcluded(
	settings: WeightedRecallSettings,
	path: string,
): boolean {
	return settings.excludedFolders.some((excl) => isUnderFolder(path, excl));
}

/** path가 속한 폴더 중 가장 긴(가장 구체적인) 폴더를 반환. */
export function longestPrefixFolder(
	settings: WeightedRecallSettings,
	path: string,
): FolderEntry | undefined {
	let best: FolderEntry | undefined;
	for (const f of settings.folders) {
		if (
			isUnderFolder(path, f.path) &&
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

// ── 테마 프로파일 ──

export function makeProfileId(): string {
	return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 활성 프로파일. 미스매치·빈 목록도 안전(빈 weights → 미러 weight 폴백). */
export function getActiveProfile(
	settings: WeightedRecallSettings,
): WeightProfile {
	return (
		settings.profiles.find((p) => p.id === settings.activeProfileId) ??
		settings.profiles[0] ?? { id: "default", name: "설교", weights: {} }
	);
}

/** 한 폴더의 프로파일별 가중치 중 최대값(0~10). 키 누락 시 미러 weight 폴백. */
export function folderMaxWeight10(
	settings: WeightedRecallSettings,
	folder: FolderEntry,
): number {
	let max = 0;
	let anyDefined = false;
	for (const p of settings.profiles) {
		const w = p.weights[folder.path];
		if (typeof w === "number" && Number.isFinite(w)) {
			anyDefined = true;
			max = Math.max(max, clampWeight10(w));
		}
	}
	return anyDefined ? max : clampWeight10(folder.weight);
}

/**
 * 인덱싱 범위(scope) 가중치(0~10) — 전 프로파일의 최대값.
 * notes.weight에는 이 값의 내부 배율이 저장되고, SQL의 `weight > 0`은
 * "어떤 프로파일에서든 사용됨" 게이트가 된다. 0 = 어떤 프로파일도 안 씀.
 */
export function scopeWeight10(
	settings: WeightedRecallSettings,
	path: string,
): number {
	if (isPathExcluded(settings, path)) return 0;
	const entry = longestPrefixFolder(settings, path);
	if (!entry) return 0;
	return folderMaxWeight10(settings, entry);
}

/** 활성 프로파일 관점의 가중치(0~10). 제외/미매칭은 0. */
export function resolveWeight10(
	settings: WeightedRecallSettings,
	path: string,
): number {
	if (isPathExcluded(settings, path)) return 0;
	const entry = longestPrefixFolder(settings, path);
	if (!entry) return 0;
	const w = getActiveProfile(settings).weights[entry.path];
	return typeof w === "number" && Number.isFinite(w)
		? clampWeight10(w)
		: clampWeight10(entry.weight);
}

export type WeightResolver = (notePath: string) => number;

/**
 * 활성 프로파일 기준 내부 배율(0~1.5) 해석기 — 검색 함수에 주입한다.
 * 같은 노트의 청크가 반복 조회되므로 경로별 메모이즈.
 */
export function makeWeightResolver(
	settings: WeightedRecallSettings,
): WeightResolver {
	const memo = new Map<string, number>();
	return (notePath: string) => {
		const cached = memo.get(notePath);
		if (cached !== undefined) return cached;
		const w = weightToInternal(resolveWeight10(settings, notePath));
		memo.set(notePath, w);
		return w;
	};
}

/** folders[].weight(구버전 호환 미러)를 활성 프로파일 값으로 in-place 동기화. */
export function mirrorActiveWeights(settings: WeightedRecallSettings): void {
	const active = getActiveProfile(settings);
	for (const f of settings.folders) {
		const w = active.weights[f.path];
		if (typeof w === "number" && Number.isFinite(w)) {
			f.weight = clampWeight10(w);
		}
	}
}

/**
 * 폴더 설정의 지문 — 인덱스(DB)가 현재 설정과 동기화됐는지 판별용.
 * v3부터 scope 기준: 프로파일 전환·가중치 조정(0↔N 제외)은 지문을 바꾸지 않아
 * 재적용 없이 즉시 반영되고, 폴더 추가/제거·그룹 이동·0↔N 전환·제외 변경만
 * 배너(재적용/재색인 안내)를 띄운다.
 */
export function foldersFingerprint(settings: WeightedRecallSettings): string {
	const f = settings.folders
		.map(
			(x) =>
				`${x.path}|${x.groupId}|${folderMaxWeight10(settings, x) > 0 ? 1 : 0}`,
		)
		.sort()
		.join(";");
	const e = settings.excludedFolders.slice().sort().join(";");
	return `v3|${f}||${e}`;
}
