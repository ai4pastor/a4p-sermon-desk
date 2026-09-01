import { App, TFile, normalizePath } from "obsidian";
import type { Database } from "sql.js";
import type { HybridHit, MatchedKey } from "./hybrid";
import { tokenize } from "../morpheme";
import { getDistinctDoctrineKeys, getDistinctTagKeys } from "../db/embeddings";

const W_DOCTRINE_EXACT = 3;
const W_DOCTRINE_SYN = 2;
const W_DOCTRINE_VEC = 1.0;
const W_TAG_EXACT = 1;
const W_TAG_VEC = 0.5;
// 벡터(의미 유사도)로 텍스트가 놓친 키를 발견할 때의 파라미터. RecallView에서 사용.
// doctrine 키(한자 추상어)는 같은 의미라도 코사인이 ~0.1 낮아 threshold를 분리한다(실측 근거).
export const VEC_THRESHOLD_DOCTRINE = 0.5;
export const VEC_THRESHOLD_TAG = 0.6;
export const VEC_TOPK = 5;

export interface SearchLexicons {
	doctrine: Set<string>;
	tag: Set<string>;
}

export function loadSearchLexicons(db: Database): SearchLexicons {
	return {
		doctrine: new Set(getDistinctDoctrineKeys(db)),
		tag: new Set(getDistinctTagKeys(db)),
	};
}

export interface QueryKeys {
	dExact: Set<string>;
	dSyn: Set<string>;
	tExact: Set<string>;
	// 텍스트가 놓친 의미 유사 키(벡터 발견). RecallView가 채운다. 기본 빈 Set.
	dVec: Set<string>;
	tVec: Set<string>;
}

export async function buildSynonymTokenIndex(
	synonyms: Record<string, string[]>,
): Promise<Map<string, string[][]>> {
	const index = new Map<string, string[][]>();
	for (const [key, syns] of Object.entries(synonyms)) {
		const lists: string[][] = [];
		for (const syn of syns) {
			const stems = await tokenize(stripEmoji(syn));
			if (stems.length === 0) continue;
			// 단일 어간이 1글자면 과매칭 위험(예: "남","위") → 제외.
			// "거듭나"·"태어나" 같은 2글자+ 단일 어간은 유지.
			if (stems.length === 1 && stems[0].length < 2) continue;
			lists.push(stems);
		}
		if (lists.length > 0) index.set(key, lists);
	}
	return index;
}

export async function extractQueryKeysWithSynonyms(
	queryText: string,
	lexicons: SearchLexicons,
	synonymIndex: Map<string, string[][]>,
): Promise<QueryKeys> {
	const matched = await extractQueryKeys(
		queryText,
		new Set([...lexicons.doctrine, ...lexicons.tag]),
	);
	const dExact = new Set<string>();
	const tExact = new Set<string>();
	for (const k of matched) {
		if (lexicons.doctrine.has(k)) dExact.add(k);
		if (lexicons.tag.has(k)) tExact.add(k);
	}
	const dSyn = new Set<string>();
	if (synonymIndex.size > 0) {
		const bodyStems = new Set(await tokenize(stripEmoji(queryText)));
		if (bodyStems.size > 0) {
			for (const [key, lists] of synonymIndex) {
				if (!lexicons.doctrine.has(key)) continue;
				if (dExact.has(key)) continue;
				for (const stems of lists) {
					if (stems.every((s) => bodyStems.has(s))) {
						dSyn.add(key);
						break;
					}
				}
			}
		}
	}
	return { dExact, dSyn, tExact, dVec: new Set(), tVec: new Set() };
}

const TAG_FRONTMATTER_FIELDS = ["tags", "doctrine"];

export function normalizeTag(s: string): string {
	let t = s.trim();
	if (t.startsWith("#")) t = t.slice(1);
	if (t.startsWith("[[") && t.endsWith("]]")) t = t.slice(2, -2);
	const pipe = t.indexOf("|");
	if (pipe >= 0) t = t.slice(0, pipe);
	const hash = t.indexOf("#");
	if (hash >= 0) t = t.slice(0, hash);
	const caret = t.indexOf("^");
	if (caret >= 0) t = t.slice(0, caret);
	t = t.replace(/^(\p{Extended_Pictographic}\uFE0F?\s*)+/u, "");
	// NFD \uD14D\uC2A4\uD2B8\uAC00 \uC11E\uC5EC\uB3C4 \uC0C9\uC778\u00B7\uCFFC\uB9AC \uD0A4\uAC00 \uC77C\uCE58\uD558\uB3C4\uB85D \uD1B5\uC77C.
	return t.trim().normalize("NFC");
}

export function addLinkVariants(tags: Set<string>, raw: string): void {
	const n = normalizeTag(raw);
	if (n) tags.add(n);
	let target = raw.trim();
	if (target.startsWith("[[") && target.endsWith("]]")) {
		target = target.slice(2, -2);
	}
	const pipe = target.indexOf("|");
	if (pipe >= 0) target = target.slice(0, pipe);
	const slash = target.lastIndexOf("/");
	if (slash >= 0) {
		const base = normalizeTag(target.slice(slash + 1));
		if (base) tags.add(base);
	}
}

function addFromFrontmatter(
	tags: Set<string>,
	fm: Record<string, unknown>,
): void {
	for (const field of TAG_FRONTMATTER_FIELDS) {
		const val = fm[field];
		if (Array.isArray(val)) {
			for (const v of val) {
				if (typeof v === "string" && v.trim()) addLinkVariants(tags, v);
			}
		} else if (typeof val === "string" && val.trim()) {
			for (const piece of val.split(",")) {
				const p = piece.trim();
				if (p) addLinkVariants(tags, p);
			}
		}
	}
}

function stripEmoji(s: string): string {
	return s.replace(/[\p{Extended_Pictographic}️]/gu, " ");
}

export function buildLexicon(db: Database): Set<string> {
	const set = new Set<string>();
	const rows = db.exec(
		`SELECT key FROM (
			SELECT doctrine_key AS key FROM note_doctrines
			UNION
			SELECT tag_key FROM note_tags
		)`,
	);
	if (rows[0]) {
		for (const r of rows[0].values) {
			const k = String(r[0]);
			if (k) set.add(k);
		}
	}
	return set;
}

export async function extractQueryKeys(
	queryText: string,
	lexicon: Set<string>,
): Promise<Set<string>> {
	const keys = new Set<string>();
	if (!queryText) return keys;

	const reHash = /#([\p{L}\p{N}_\-/]+)/gu;
	let m: RegExpExecArray | null;
	while ((m = reHash.exec(queryText)) !== null) {
		const n = normalizeTag(m[1]);
		if (n) keys.add(n);
	}
	const reLink = /\[\[([^\]]+)\]\]/g;
	while ((m = reLink.exec(queryText)) !== null) {
		addLinkVariants(keys, m[1]);
	}

	if (lexicon.size > 0) {
		const cleaned = stripEmoji(queryText);
		const tokens = await tokenize(cleaned);
		const tokenMatches = new Set<string>();
		for (const tok of tokens) {
			if (lexicon.has(tok)) tokenMatches.add(tok);
		}
		const substringMatches = new Set<string>();
		for (const key of lexicon) {
			if (key.length < 2) continue;
			// 라틴 키는 단어 경계 필수 — "art"가 "start"에 오탐되지 않게.
			// 한글은 조사·어미가 붙는 특성상 부분 포함("구원"⊂"구원하다")을 유지.
			if (/^[\x20-\x7e]+$/.test(key)) {
				const re = new RegExp(
					`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
					"i",
				);
				if (re.test(cleaned)) substringMatches.add(key);
			} else if (cleaned.includes(key)) {
				substringMatches.add(key);
			}
		}
		for (const k of tokenMatches) keys.add(k);
		for (const k of substringMatches) keys.add(k);
	}

	return keys;
}

export function extractQueryTags(queryText: string): Set<string> {
	const tags = new Set<string>();
	if (!queryText) return tags;
	const reHash = /#([\p{L}\p{N}_\-/]+)/gu;
	let m: RegExpExecArray | null;
	while ((m = reHash.exec(queryText)) !== null) {
		const n = normalizeTag(m[1]);
		if (n) tags.add(n);
	}
	const reLink = /\[\[([^\]]+)\]\]/g;
	while ((m = reLink.exec(queryText)) !== null) {
		addLinkVariants(tags, m[1]);
	}
	return tags;
}

export function extractTags(app: App, path: string): Set<string> {
	const tags = new Set<string>();
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return tags;
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return tags;
	if (cache.tags) {
		for (const t of cache.tags) {
			const n = normalizeTag(t.tag);
			if (n) tags.add(n);
		}
	}
	if (cache.frontmatter) addFromFrontmatter(tags, cache.frontmatter);
	if (cache.links) {
		for (const l of cache.links) addLinkVariants(tags, l.link);
	}
	const fmLinks = (
		cache as { frontmatterLinks?: Array<{ key: string; link: string }> }
	).frontmatterLinks;
	if (fmLinks) {
		for (const l of fmLinks) {
			const fieldRoot = l.key.split(".")[0];
			if (TAG_FRONTMATTER_FIELDS.includes(fieldRoot)) {
				addLinkVariants(tags, l.link);
			}
		}
	}
	return tags;
}

export interface TagSearchOpts {
	topN?: number;
	excludePath?: string;
	/**
	 * 활성 테마 프로파일의 가중치 해석기(내부 배율 0~1.5). 0 = 제외.
	 * 미지정 시 DB notes.weight(scope 값) 사용 — 디버그·폴백 전용.
	 */
	resolveWeight?: (notePath: string) => number;
}

export function tagSearch(
	db: Database,
	keys: QueryKeys,
	_app: App,
	opts: TagSearchOpts = {},
): HybridHit[] {
	const allKeys = new Set([
		...keys.dExact,
		...keys.dSyn,
		...keys.dVec,
		...keys.tExact,
		...keys.tVec,
	]);
	if (allKeys.size === 0) return [];
	const topN = opts.topN ?? 10;

	const allKeysArr = [...allKeys];
	const placeholders = allKeysArr.map(() => "?").join(",");

	const docRows = db.exec(
		`SELECT note_path, doctrine_key FROM note_doctrines WHERE doctrine_key IN (${placeholders})`,
		allKeysArr,
	);
	const tagRows = db.exec(
		`SELECT note_path, tag_key FROM note_tags WHERE tag_key IN (${placeholders})`,
		allKeysArr,
	);

	const scores = new Map<string, number>();
	// 실제 매칭 키 수 — matchedQueryTerms 표시용 (가중합 rawScore와 별개).
	const matchCounts = new Map<string, number>();
	// 추천 근거 키 — 카드 칩 표시용.
	const keyMatches = new Map<string, MatchedKey[]>();
	const addMatch = (path: string, key: string, kind: MatchedKey["kind"]) => {
		const list = keyMatches.get(path);
		if (list) list.push({ key, kind });
		else keyMatches.set(path, [{ key, kind }]);
	};
	if (docRows[0]) {
		for (const r of docRows[0].values) {
			const path = String(r[0]);
			const key = String(r[1]);
			let w = 0;
			let kind: MatchedKey["kind"];
			if (keys.dExact.has(key)) {
				w = W_DOCTRINE_EXACT;
				kind = "dExact";
			} else if (keys.dSyn.has(key)) {
				w = W_DOCTRINE_SYN;
				kind = "dSyn";
			} else if (keys.dVec.has(key)) {
				w = W_DOCTRINE_VEC;
				kind = "dVec";
			} else continue;
			scores.set(path, (scores.get(path) ?? 0) + w);
			matchCounts.set(path, (matchCounts.get(path) ?? 0) + 1);
			addMatch(path, key, kind);
		}
	}
	if (tagRows[0]) {
		for (const r of tagRows[0].values) {
			const path = String(r[0]);
			const key = String(r[1]);
			let w = 0;
			let kind: MatchedKey["kind"];
			if (keys.tExact.has(key)) {
				w = W_TAG_EXACT;
				kind = "tExact";
			} else if (keys.tVec.has(key)) {
				w = W_TAG_VEC;
				kind = "tVec";
			} else continue;
			scores.set(path, (scores.get(path) ?? 0) + w);
			matchCounts.set(path, (matchCounts.get(path) ?? 0) + 1);
			addMatch(path, key, kind);
		}
	}

	if (scores.size === 0) return [];

	const candidatePaths = [...scores.keys()];
	const noteRows = db.exec(
		`SELECT path, category_id, weight FROM notes WHERE path IN (${candidatePaths.map(() => "?").join(",")})`,
		candidatePaths,
	);
	if (!noteRows[0]) return [];

	type Cand = {
		path: string;
		categoryId: string;
		weight: number;
		rawScore: number;
		finalScore: number;
	};
	const excludeNorm = opts.excludePath
		? normalizePath(opts.excludePath)
		: null;
	const candidates: Cand[] = [];
	for (const row of noteRows[0].values) {
		const path = String(row[0]);
		if (excludeNorm && normalizePath(path) === excludeNorm) continue;
		const rawScore = scores.get(path) ?? 0;
		if (rawScore === 0) continue;
		const weight = opts.resolveWeight
			? opts.resolveWeight(path)
			: Number(row[2]);
		// weight 0 = 검색 제외 의도(활성 프로파일 0점 포함) — reapply 직후에도 노출 방지.
		if (weight <= 0) continue;
		candidates.push({
			path,
			categoryId: String(row[1]),
			weight,
			rawScore,
			finalScore: rawScore * weight,
		});
	}

	candidates.sort((a, b) => b.finalScore - a.finalScore);
	const top = candidates.slice(0, topN);
	if (top.length === 0) return [];

	const chunkPlaceholders = top.map(() => "?").join(",");
	const chunkRows = db.exec(
		`SELECT id, note_path, ord, heading, text FROM chunks WHERE note_path IN (${chunkPlaceholders}) ORDER BY note_path, ord`,
		top.map((c) => c.path),
	);
	const firstChunks = new Map<
		string,
		{
			id: number;
			ord: number;
			heading: string | null;
			text: string;
		}
	>();
	if (chunkRows[0]) {
		for (const r of chunkRows[0].values) {
			const path = String(r[1]);
			if (firstChunks.has(path)) continue;
			firstChunks.set(path, {
				id: Number(r[0]),
				ord: Number(r[2]),
				heading: r[3] === null ? null : String(r[3]),
				text: String(r[4]),
			});
		}
	}

	const hits: HybridHit[] = [];
	for (const c of top) {
		const chunk = firstChunks.get(c.path);
		if (!chunk) continue;
		const noteName =
			c.path.replace(/\.md$/, "").split("/").pop() ?? c.path;
		hits.push({
			chunkId: chunk.id,
			notePath: c.path,
			noteTitle: noteName,
			heading: chunk.heading,
			preview: chunk.text.slice(0, 200),
			fullText: chunk.text,
			categoryId: c.categoryId,
			noteWeight: c.weight,
			rrfScore: 0,
			finalScore: c.finalScore,
			bm25Rank: null,
			vectorRank: null,
			bm25Score: null,
			vectorScore: null,
			headingMatched: false,
			matchedQueryTerms: matchCounts.get(c.path) ?? 0,
			queryTermsTotal: allKeys.size,
			matchedKeys: keyMatches.get(c.path) ?? [],
		});
	}
	return hits;
}
