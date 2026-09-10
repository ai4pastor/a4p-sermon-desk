// 노트 → (렉시콘, 키)·태그 키 도출. 순수 함수(obsidian 무의존) — parser.ts가 metadataCache에서
// 입력을 만들어 넘긴다. 규칙 순서(PR-B B-3):
//   (1) 렉시콘 L의 매핑 필드(≠"tags") frontmatter 값·frontmatterLinks → L 무조건
//   (2) frontmatter tags·인라인 태그 → tagSet
//   (3) 본문 링크: 변형 키가 L.keys에 있는 모든 L → L, 없으면 tagSet
//   (4) fields에 "tags"를 가진 L: tagSet ∩ L.keys → L (태그 폴백)
//   (5) 어떤 렉시콘으로든 승격된 키는 tagSet에서 제거
import { addLinkVariants, normalizeTag } from "../search/tag-normalize";

export interface IndexLexicon {
	id: string;
	/** 매핑할 frontmatter 필드. "tags"가 있으면 규칙 (4) 태그 폴백. */
	fields: string[];
	/** 정규화된 키워드 집합 — 본문 링크(3)·태그 폴백(4) 판정용. */
	keys: Set<string>;
}

export interface NoteKeyInput {
	frontmatter: Record<string, unknown>;
	/** 인라인 태그 원문(cache.tags[].tag, "#" 포함 가능). */
	inlineTags: string[];
	/** 본문 링크 대상 원문(cache.links[].link). */
	links: string[];
	/** frontmatter 안 위키링크(cache.frontmatterLinks) — key는 "doctrine.0" 같은 경로. */
	frontmatterLinks: { key: string; link: string }[];
}

export interface NoteKeys {
	lexiconKeys: { lexiconId: string; key: string }[];
	tagKeys: string[];
}

/** 설정의 렉시콘 → 색인용(키워드 정규화·빈 값 제거). */
export function toIndexLexicons(
	lexicons: ReadonlyArray<{
		id: string;
		fields: readonly string[];
		keywords: readonly string[];
	}>,
): IndexLexicon[] {
	return lexicons.map((l) => ({
		id: l.id,
		fields: [...l.fields],
		keys: new Set(
			l.keywords.map((k) => normalizeTag(k)).filter((k) => k.length > 0),
		),
	}));
}

/** frontmatter 값(문자열 | 문자열 배열)을 문자열 목록으로. splitComma는 tags 필드 전용. */
function fmStrings(value: unknown, splitComma: boolean): string[] {
	if (Array.isArray(value)) {
		return value.filter(
			(v): v is string => typeof v === "string" && v.trim().length > 0,
		);
	}
	if (typeof value !== "string" || !value.trim()) return [];
	return splitComma
		? value.split(",").map((p) => p.trim()).filter((p) => p.length > 0)
		: [value];
}

export function deriveNoteKeys(
	input: NoteKeyInput,
	lexicons: IndexLexicon[],
): NoteKeys {
	const lexSets = new Map<string, Set<string>>();
	const setOf = (id: string): Set<string> => {
		let s = lexSets.get(id);
		if (!s) {
			s = new Set();
			lexSets.set(id, s);
		}
		return s;
	};
	const tagSet = new Set<string>();

	// (1) 렉시콘 매핑 필드 — 구 doctrine 동작대로 문자열 값은 쉼표 분리하지 않는다.
	for (const L of lexicons) {
		for (const field of L.fields) {
			if (field === "tags") continue;
			for (const v of fmStrings(input.frontmatter[field], false)) {
				addLinkVariants(setOf(L.id), v);
			}
		}
	}
	for (const fl of input.frontmatterLinks) {
		const root = fl.key.split(".")[0];
		if (root === "tags") {
			addLinkVariants(tagSet, fl.link);
			continue;
		}
		for (const L of lexicons) {
			if (L.fields.includes(root)) addLinkVariants(setOf(L.id), fl.link);
		}
	}

	// (2) 태그
	for (const v of fmStrings(input.frontmatter.tags, true)) {
		addLinkVariants(tagSet, v);
	}
	for (const t of input.inlineTags) {
		const n = normalizeTag(t);
		if (n) tagSet.add(n);
	}

	// (3) 본문 링크
	for (const link of input.links) {
		const variants = new Set<string>();
		addLinkVariants(variants, link);
		for (const k of variants) {
			const owners = lexicons.filter((L) => L.keys.has(k));
			if (owners.length === 0) {
				tagSet.add(k);
				continue;
			}
			for (const L of owners) setOf(L.id).add(k);
		}
	}

	// (4) 태그 폴백
	for (const L of lexicons) {
		if (!L.fields.includes("tags")) continue;
		for (const k of tagSet) {
			if (L.keys.has(k)) setOf(L.id).add(k);
		}
	}

	// (5) 승격 키 제거
	for (const s of lexSets.values()) {
		for (const k of s) tagSet.delete(k);
	}

	const lexiconKeys: NoteKeys["lexiconKeys"] = [];
	for (const L of lexicons) {
		const s = lexSets.get(L.id);
		if (!s) continue;
		for (const key of s) lexiconKeys.push({ lexiconId: L.id, key });
	}
	return { lexiconKeys, tagKeys: [...tagSet] };
}
