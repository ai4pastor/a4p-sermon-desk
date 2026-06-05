import { App, TFile, getAllTags } from "obsidian";
import { addLinkVariants, normalizeTag } from "../search/tag";

export interface ParsedNote {
	frontmatter: Record<string, unknown>;
	body: string;
	tags: string[];
	doctrineKeys: string[];
	tagKeys: string[];
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\s*\r?\n?/;

export function stripFrontmatter(content: string): string {
	return content.replace(FRONTMATTER_RE, "");
}

export async function parseFile(
	app: App,
	file: TFile,
	doctrineLexicon: Set<string>,
): Promise<ParsedNote> {
	const content = await app.vault.cachedRead(file);
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
	const body = stripFrontmatter(content);
	const rawTags = cache ? (getAllTags(cache) ?? []) : [];
	const tags = Array.from(
		new Set(rawTags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean)),
	);

	const doctrineSet = new Set<string>();
	const tagSet = new Set<string>();

	const fmDoctrine = frontmatter.doctrine;
	if (fmDoctrine) {
		const vals = Array.isArray(fmDoctrine) ? fmDoctrine : [fmDoctrine];
		for (const v of vals) {
			if (typeof v === "string" && v.trim()) {
				addLinkVariants(doctrineSet, v);
			}
		}
	}
	const fmTags = frontmatter.tags;
	if (fmTags) {
		const vals = Array.isArray(fmTags)
			? fmTags
			: typeof fmTags === "string"
				? fmTags.split(",")
				: [];
		for (const v of vals) {
			if (typeof v === "string" && v.trim()) {
				addLinkVariants(tagSet, v);
			}
		}
	}
	if (cache?.tags) {
		for (const t of cache.tags) {
			const n = normalizeTag(t.tag);
			if (n) tagSet.add(n);
		}
	}
	if (cache?.links) {
		for (const l of cache.links) {
			const tmp = new Set<string>();
			addLinkVariants(tmp, l.link);
			for (const k of tmp) {
				if (doctrineLexicon.has(k)) doctrineSet.add(k);
				else tagSet.add(k);
			}
		}
	}
	const fmLinks = (
		cache as { frontmatterLinks?: Array<{ key: string; link: string }> } | null
	)?.frontmatterLinks;
	if (fmLinks) {
		for (const l of fmLinks) {
			const fieldRoot = l.key.split(".")[0];
			if (fieldRoot === "doctrine") addLinkVariants(doctrineSet, l.link);
			else if (fieldRoot === "tags") addLinkVariants(tagSet, l.link);
		}
	}

	for (const k of doctrineSet) tagSet.delete(k);

	return {
		frontmatter,
		body,
		tags,
		doctrineKeys: [...doctrineSet],
		tagKeys: [...tagSet],
	};
}
