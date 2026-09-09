// 형태소 보호 단어 — garu가 쪼개거나 떨어뜨리는 핵심 어휘(교리어 등)를 토큰으로
// 보장한다. 순수 모듈(wasm 미의존)이라 노드 테스트·실측 하니스에서도 그대로 쓴다.
//
// 동작: 텍스트에 보호 단어가 n회 등장하는데 형태소 토큰에 그 단어가 m(<n)개뿐이면
// 부족분(n−m)만 토큰을 추가한다. garu가 이미 뽑은 단어는 중복되지 않는다.
// 예) "거룩해지는 삶" → garu [해지] + 보호어 "거룩" 1회 등장 → [해지, 거룩]
import { KO_STOPWORDS } from "./stopwords";

const HANGUL_RE = /[ㄱ-ㆎ가-힣]/;
const EMOJI_RE = /[\p{Extended_Pictographic}️]/gu;

export interface ProtectedSource {
	doctrineKeywords: readonly string[];
	doctrineSynonyms: Readonly<Record<string, readonly string[]>>;
	protectedTerms: readonly string[];
}

/**
 * 보호 단어 하나를 정규화. 규칙: NFC·이모지 제거·양끝 공백 제거, 내부 공백 없음,
 * 2글자 이상, 불용어 아님. 한글 없는 단어(예: "AI")는 소문자로(토크나이저와 동일).
 * 부적합하면 null.
 */
export function normalizeProtectedTerm(raw: string): string | null {
	let t = raw.normalize("NFC").replace(EMOJI_RE, "").trim();
	if (!t) return null;
	if (/\s/.test(t)) return null;
	if (!HANGUL_RE.test(t)) t = t.toLowerCase();
	if (t.length < 2) return null;
	if (KO_STOPWORDS.has(t)) return null;
	return t;
}

/** 설정 텍스트(줄바꿈·쉼표 구분)를 보호 단어 목록으로. */
export function parseProtectedInput(text: string): string[] {
	const out = new Set<string>();
	for (const piece of text.split(/[\n,]/)) {
		const t = normalizeProtectedTerm(piece);
		if (t) out.add(t);
	}
	return [...out].sort();
}

/** 교리 키워드 ∪ 동의어(단어형) ∪ 직접 추가 — 정규화·중복 제거·정렬. */
export function deriveProtectedTerms(src: ProtectedSource): string[] {
	const out = new Set<string>();
	const add = (raw: string) => {
		const t = normalizeProtectedTerm(raw);
		if (t) out.add(t);
	};
	for (const k of src.doctrineKeywords) add(k);
	for (const list of Object.values(src.doctrineSynonyms)) {
		for (const s of list) add(s);
	}
	for (const p of src.protectedTerms) add(p);
	return [...out].sort();
}

/** 비중첩 등장 횟수. 한글 없는 단어는 소문자 비교. */
export function countOccurrences(text: string, term: string): number {
	if (!term) return 0;
	const hay = HANGUL_RE.test(term) ? text : text.toLowerCase();
	let n = 0;
	let i = hay.indexOf(term);
	while (i >= 0) {
		n++;
		i = hay.indexOf(term, i + term.length);
	}
	return n;
}

/**
 * 형태소 토큰에 보호 단어를 보충. 텍스트 등장 횟수 − 이미 있는 토큰 수 만큼만 추가.
 * 입력 배열은 바꾸지 않고 새 배열을 돌려준다.
 */
export function topUpProtected(
	tokens: readonly string[],
	text: string,
	terms: readonly string[],
): string[] {
	if (terms.length === 0 || !text) return [...tokens];
	const out = [...tokens];
	let have: Map<string, number> | null = null;
	for (const term of terms) {
		const occ = countOccurrences(text, term);
		if (occ === 0) continue;
		if (!have) {
			have = new Map();
			for (const t of tokens) have.set(t, (have.get(t) ?? 0) + 1);
		}
		const missing = occ - (have.get(term) ?? 0);
		for (let i = 0; i < missing; i++) out.push(term);
	}
	return out;
}

/** 보호 단어 목록 지문 — meta에 저장해 "색인 반영 여부"를 판정. */
export function protectedFingerprint(terms: readonly string[]): string {
	let h = 5381;
	const joined = [...terms].sort().join("\n");
	for (let i = 0; i < joined.length; i++) {
		h = ((h << 5) + h + joined.charCodeAt(i)) | 0;
	}
	return `${terms.length}:${(h >>> 0).toString(16)}`;
}
