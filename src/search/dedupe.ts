import type { HybridHit } from "./hybrid";

export function canonicalTitle(t: string): string {
	// 사본 접미어만 접는다. 단순 "공백+숫자"를 접으면
	// "시편 23"/"시편 100" 같은 정당한 시리즈 노트가 하나로 합쳐진다.
	return t
		.replace(/\s+복사본(\s+\d+)?$/, "")
		.replace(/\s+copy(\s+\d+)?$/i, "")
		.trim();
}

export function dedupeHits(hits: HybridHit[]): HybridHit[] {
	const byPath = new Map<string, HybridHit>();
	for (const h of hits) {
		const cur = byPath.get(h.notePath);
		if (!cur || h.finalScore > cur.finalScore) byPath.set(h.notePath, h);
	}
	const byTitle = new Map<string, HybridHit>();
	for (const h of byPath.values()) {
		const titleKey = canonicalTitle(h.noteTitle);
		const cur = byTitle.get(titleKey);
		const better =
			!cur ||
			h.noteWeight > cur.noteWeight ||
			(h.noteWeight === cur.noteWeight && h.finalScore > cur.finalScore);
		if (better) byTitle.set(titleKey, h);
	}
	return [...byTitle.values()].sort((a, b) => b.finalScore - a.finalScore);
}
