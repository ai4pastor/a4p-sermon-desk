// 렌더된 마크다운 DOM 보조 — 검색어 <mark> 표시와 블록 수집. HitList·NotePopupModal 공용.
import type { AnchorBlock } from "../anchor";
import { buildTermRegex, splitByTerms } from "../markdown-text";

/**
 * 렌더된 마크다운의 텍스트 노드에서 검색어를 <mark>로 감싼다.
 * 코드·이미 표시된 곳은 건너뛰고, 링크 텍스트(위키링크 별칭)는 내용이므로 포함.
 */
export function highlightRendered(root: HTMLElement, terms: string[]): void {
	const re = buildTermRegex(terms);
	if (!re) return;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const targets: Text[] = [];
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const t = node as Text;
		if (!t.nodeValue) continue;
		if (t.parentElement?.closest("code, pre, mark")) continue;
		targets.push(t);
	}
	for (const t of targets) {
		const parts = splitByTerms(t.nodeValue ?? "", re);
		if (!parts.some((p) => p.hit)) continue;
		const frag = document.createDocumentFragment();
		for (const p of parts) {
			if (p.hit) {
				const mark = document.createElement("mark");
				mark.className = "wr-mark";
				mark.textContent = p.text;
				frag.appendChild(mark);
			} else {
				frag.appendChild(document.createTextNode(p.text));
			}
		}
		t.replaceWith(frag);
	}
}

/** 앵커 후보가 되는 블록 요소. */
export const BLOCK_SELECTOR =
	"p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td";

export interface DomBlock extends AnchorBlock {
	el: HTMLElement;
}

/**
 * 블록 요소와 그 자기 텍스트를 문서 순서로 모은다. 자기 텍스트 = 가장 가까운
 * 블록 조상이 자신인 텍스트 노드만 — 중첩 목록에서 바깥 li가 자식 항목 텍스트까지
 * 품어 항상 바깥이 잡히던 문제를 막는다.
 */
export function collectBlocks(root: HTMLElement): DomBlock[] {
	const els = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
	return els.map((el) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let text = "";
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const parent = (node as Text).parentElement;
			if (parent && parent.closest(BLOCK_SELECTOR) !== el) continue;
			text += node.nodeValue ?? "";
		}
		return { el, tag: el.tagName.toLowerCase(), text };
	});
}
