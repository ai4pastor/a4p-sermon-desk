// 검색 결과 표시용 마크다운 → 평문 투영. obsidian 무의존(vitest에서 그대로 로드).
// 불용어는 ./morpheme/stopwords에서만 가져온다 — ./morpheme/index.ts는 WASM 로더라
// 노드 테스트에서 읽을 수 없다(tests/helpers/garu-node.ts와 같은 이유).
import { KO_STOPWORDS } from "./morpheme/stopwords";

/** 색인 시점에 청크 앞에 붙는 태그 접두 — indexer.ts의 tagPrefix 형식과 일치. */
export const TAG_PREFIX_RE = /^\[태그:([^\]]*)\]\s*/;

/** 접힌 미리보기에서 줄바꿈을 대신하는 구분 글리프. */
export const LINE_JOINER = " · ";

const SNIPPET_LEN = 160;

export function stripTagPrefix(text: string): string {
	return text.replace(TAG_PREFIX_RE, "");
}

/** "[태그: a, b] …" → ["a", "b"]. 접두가 없으면 []. 공백·중복 정리. */
export function parseTagPrefix(text: string): string[] {
	const m = TAG_PREFIX_RE.exec(text);
	if (!m) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of m[1].split(",")) {
		const t = raw.trim();
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	return out;
}

/** [[a/b#h|c]] → c, [[a/b#h]] → b, [[#h]] → h */
function wikilinkLabel(target: string): string {
	const t = target.trim();
	const cuts = [t.indexOf("#"), t.indexOf("^")].filter((i) => i >= 0);
	let head = t;
	let sub = "";
	if (cuts.length > 0) {
		const i = Math.min(...cuts);
		head = t.slice(0, i).trim();
		sub = t.slice(i + 1).trim();
	}
	if (!head) return sub;
	const slash = head.lastIndexOf("/");
	return slash >= 0 ? head.slice(slash + 1) : head;
}

/**
 * 한 줄 안의 마크다운 기호를 걷어낸다. 순서가 중요하다 — 링크를 강조보다 먼저
 * 처리해야 [**a**](u), **[a](u)**, [[x|**b**]]가 모두 평문이 된다.
 */
export function stripInlineMarkdown(s: string): string {
	let t = s;
	// 1. 임베드(이미지·노트) — 위키링크보다 먼저
	t = t.replace(/!\[\[[^\]]*\]\]/g, "");
	t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
	// 2. 위키링크 → 별칭, 없으면 대상 노트명
	t = t.replace(
		/\[\[([^\]|]*?)(?:\|([^\]]*))?\]\]/g,
		(_m, target: string, alias?: string) =>
			alias !== undefined && alias.trim() ? alias.trim() : wikilinkLabel(target),
	);
	// 3. 마크다운 링크 → 텍스트. "(" 없는 단일 대괄호는 Obsidian도 그대로 렌더하므로 둔다.
	t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
	// 4. HTML — 글자로 시작하는 태그만("a < b" 보존)
	t = t.replace(/<br\s*\/?>/gi, " ");
	t = t.replace(/<\/?[a-zA-Z][^<>]*>/g, "");
	// 5. 인라인 코드
	t = t.replace(/`([^`]*)`/g, "$1");
	// 6. 강조 마커. 단일 _는 단어 경계에서만(snake_case·파일명 보존).
	t = t.replace(/\*{1,3}|_{2,3}|==|~~/g, "");
	t = t.replace(/(^|[\s(（>])_([^_\s][^_]*?)_(?=$|[\s.,;:!?)）])/g, "$1$2");
	// 7. 각주 참조·이스케이프 해제
	t = t.replace(/\[\^[^\]]+\]/g, "");
	t = t.replace(/\\([\\`*_{}[\]()#+\-.!>|~=])/g, "$1");
	// 8. 공백
	return t.replace(/[ \t]+/g, " ").trim();
}

const FENCE_RE = /^\s*(```|~~~)/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}[\s|:-]*$/;
const TABLE_ROW_RE = /^\s*\|(.*)\|\s*$/;
const QUOTE_RE = /^(\s*>)+\s?/;
const CALLOUT_RE = /^\[!([^\]]*)\][+-]?\s*(.*)$/;
const HEADING_RE = /^#{1,6}\s+/;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
/** 마커만 있는 빈 목록 항목("-", "1.") — Readwise 내보내기에 흔함. */
const EMPTY_LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s*$/;
const FOOTNOTE_DEF_RE = /^\[\^[^\]]+\]:\s*/;

/**
 * 청크 마크다운 → 읽을 수 있는 평문. 줄은 "\n"으로 연결된다(빈 줄 제거).
 * 콜아웃 헤더는 제목만 남기고(종류 단어·콜론 없음 → 언어 중립), 표 행은 셀을
 * LINE_JOINER로 이어 붙인다.
 */
export function toPlainText(md: string): string {
	const src = stripTagPrefix(md.replace(/\r\n?/g, "\n"));
	const out: string[] = [];
	for (const rawLine of src.split("\n")) {
		let line = rawLine.replace(QUOTE_RE, "");
		if (
			FENCE_RE.test(line) ||
			HR_RE.test(line) ||
			TABLE_SEP_RE.test(line) ||
			EMPTY_LIST_RE.test(line)
		) {
			continue;
		}
		const table = TABLE_ROW_RE.exec(line);
		if (table) {
			const cells = table[1]
				.split("|")
				.map((c) => stripInlineMarkdown(c))
				.filter((c) => c.length > 0);
			if (cells.length > 0) out.push(cells.join(LINE_JOINER));
			continue;
		}
		const callout = CALLOUT_RE.exec(line);
		if (callout) {
			line = callout[2];
			if (!line.trim()) continue;
		}
		line = line
			.replace(HEADING_RE, "")
			.replace(LIST_RE, "")
			.replace(FOOTNOTE_DEF_RE, "");
		line = stripInlineMarkdown(line);
		if (line.length > 0) out.push(line);
	}
	return out.join("\n");
}

/** 하이라이트·스니펫 위치에 쓸 검색어 — 2글자 이상, 불용어 제외. */
export function filterQueryTerms(terms: string[]): string[] {
	return terms.filter((t) => t.length >= 2 && !KO_STOPWORDS.has(t));
}

/**
 * 접힌 카드 미리보기. 평문으로 바꾼 뒤 검색어가 처음 나오는 부근을 len자 자른다.
 * 검색어가 없거나 본문에 없으면 앞부분(폴백). 줄바꿈은 LINE_JOINER.
 */
export function makeSnippet(
	fullText: string,
	terms: string[],
	len = SNIPPET_LEN,
): string {
	if (!fullText) return "";
	const plain = toPlainText(fullText).replace(/\n+/g, LINE_JOINER);
	if (plain.length <= len) return plain;
	const lower = plain.toLowerCase();
	let first = -1;
	for (const t of filterQueryTerms(terms)) {
		const i = lower.indexOf(t.toLowerCase());
		if (i >= 0 && (first < 0 || i < first)) first = i;
	}
	const start = first > 0 ? Math.max(0, first - Math.floor(len / 3)) : 0;
	const end = Math.min(plain.length, start + len);
	// 자른 양끝의 서로게이트 반쪽(이모지 절단) 제거
	const body = plain
		.slice(start, end)
		.replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, "");
	return (start > 0 ? "…" : "") + body + (end < plain.length ? "…" : "");
}

/** 검색어 하이라이트용 정규식 — 긴 것 우선·이스케이프·대소문자 무시. 없으면 null. */
export function buildTermRegex(terms: string[]): RegExp | null {
	const filtered = Array.from(new Set(filterQueryTerms(terms)));
	if (filtered.length === 0) return null;
	const escaped = filtered
		.sort((a, b) => b.length - a.length)
		.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`(${escaped.join("|")})`, "gi");
}

/** buildTermRegex로 텍스트를 [일반, 일치, 일반, …] 조각으로 나눈다(빈 조각 제거). */
export function splitByTerms(
	text: string,
	re: RegExp,
): { text: string; hit: boolean }[] {
	const parts = text.split(re);
	const out: { text: string; hit: boolean }[] = [];
	for (let i = 0; i < parts.length; i++) {
		if (parts[i].length === 0) continue;
		out.push({ text: parts[i], hit: i % 2 === 1 });
	}
	return out;
}
