// 팝업 보기 앵커 선택 — 렌더된 블록 목록에서 검색어가 가장 많이 든 블록을 고른다.
// obsidian·DOM 무의존(vitest에서 그대로 로드). DOM 수집·표시는 views/highlight-dom.ts.
import {
	buildTermRegex,
	stripInlineMarkdown,
	toPlainText,
} from "./markdown-text";

export interface AnchorBlock {
	/** 소문자 태그명 (p, li, h2 …). */
	tag: string;
	/** 자기 텍스트 — 자식 블록(중첩 목록 등)의 텍스트는 제외. */
	text: string;
}

/**
 * terms   = 검색어가 든 블록 → 하이라이트 + 스크롤
 * heading = 검색어는 없지만 청크 헤딩을 찾음 → 스크롤 + 플래시만
 * chunk   = 둘 다 없음, 청크 첫 블록 → 스크롤만
 */
export type AnchorReason = "terms" | "heading" | "chunk";

export interface AnchorPick {
	index: number;
	reason: AnchorReason;
}

/** 공백 압축 + NFC (동등 비교용). */
function normalize(s: string): string {
	return s.replace(/\s+/g, " ").trim().normalize("NFC");
}

/** 모든 공백 제거 + NFC (포함 비교용 — <br>·소프트 줄바꿈이 textContent에서 사라지는 차이 흡수). */
function compact(s: string): string {
	return s.normalize("NFC").replace(/\s+/g, "");
}

/** 청크 범위 판정에 쓰는 블록 앞부분 길이 — 각주 번호 등 뒷부분 렌더 차이에 관대하게. */
const SCOPE_PREFIX_CHARS = 24;
const MIN_SCOPE_CHARS = 4;
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function pickAnchor(
	blocks: AnchorBlock[],
	opts: { terms: string[]; chunkText: string; heading: string | null },
): AnchorPick | null {
	if (blocks.length === 0) return null;
	const chunk = compact(toPlainText(opts.chunkText));

	// 1. 청크 범위 안의 블록만 후보로 — 같은 노트의 다른 청크를 하이라이트하지 않도록.
	//    렌더 차이로 하나도 안 맞으면 전체를 후보로.
	const all = blocks.map((b, i) => ({ i, text: b.text }));
	let candidates = all.filter(({ text }) => {
		const c = compact(text);
		return (
			c.length >= MIN_SCOPE_CHARS &&
			chunk.includes(c.slice(0, SCOPE_PREFIX_CHARS))
		);
	});
	const inChunk = candidates.length > 0;
	if (!inChunk) candidates = all;

	// 2. 서로 다른 검색어를 가장 많이 담은 블록. 동점은 앞쪽.
	const re = buildTermRegex(opts.terms);
	if (re) {
		let best = -1;
		let bestScore = 0;
		for (const { i, text } of candidates) {
			const found = new Set<string>();
			for (const m of text.matchAll(re)) found.add(m[0].toLowerCase());
			if (found.size > bestScore) {
				bestScore = found.size;
				best = i;
			}
		}
		if (best >= 0) return { index: best, reason: "terms" };
	}

	// 3. 청크 헤딩과 같은 h1~h6.
	if (opts.heading) {
		const target = normalize(stripInlineMarkdown(opts.heading));
		if (target) {
			const idx = blocks.findIndex(
				(b) =>
					HEADING_TAGS.has(b.tag.toLowerCase()) &&
					normalize(b.text) === target,
			);
			if (idx >= 0) return { index: idx, reason: "heading" };
		}
	}

	// 4. 청크 범위의 첫 블록 — 위치만.
	if (inChunk) return { index: candidates[0].i, reason: "chunk" };
	return null;
}
