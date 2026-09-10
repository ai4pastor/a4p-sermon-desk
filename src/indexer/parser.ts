import { App, TFile, getAllTags } from "obsidian";
import { deriveNoteKeys, type IndexLexicon } from "./note-keys";

export interface ParsedNote {
	frontmatter: Record<string, unknown>;
	body: string;
	/** getAllTags — [태그: …] 청크 접두용(키 매핑과 별개). */
	tags: string[];
	lexiconKeys: { lexiconId: string; key: string }[];
	tagKeys: string[];
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\s*\r?\n?/;

export function stripFrontmatter(content: string): string {
	return content.replace(FRONTMATTER_RE, "");
}

/** metadataCache에서 입력을 만들어 순수 함수 deriveNoteKeys에 넘기는 얇은 래퍼. */
export async function parseFile(
	app: App,
	file: TFile,
	lexicons: IndexLexicon[],
): Promise<ParsedNote> {
	const content = await app.vault.cachedRead(file);
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
	const body = stripFrontmatter(content);
	const rawTags = cache ? (getAllTags(cache) ?? []) : [];
	const tags = Array.from(
		new Set(rawTags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean)),
	);
	const fmLinks =
		(
			cache as {
				frontmatterLinks?: Array<{ key: string; link: string }>;
			} | null
		)?.frontmatterLinks ?? [];
	const keys = deriveNoteKeys(
		{
			frontmatter,
			inlineTags: (cache?.tags ?? []).map((t) => t.tag),
			links: (cache?.links ?? []).map((l) => l.link),
			frontmatterLinks: fmLinks.map((l) => ({ key: l.key, link: l.link })),
		},
		lexicons,
	);

	return {
		frontmatter,
		body,
		tags,
		lexiconKeys: keys.lexiconKeys,
		tagKeys: keys.tagKeys,
	};
}
