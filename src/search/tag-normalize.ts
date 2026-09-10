// 키 정규화 — 태그·위키링크·frontmatter 값을 색인·쿼리 공통 키로. obsidian·wasm 무의존
// (settings.ts·indexer/note-keys.ts·테스트가 tag.ts 대신 이 파일을 import한다).

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
