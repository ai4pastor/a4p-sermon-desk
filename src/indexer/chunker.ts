export interface Chunk {
	ord: number;
	heading: string | null;
	text: string;
}

const MAX_CHUNK_CHARS = 1500;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

interface RawSection {
	heading: string | null;
	text: string;
}

function splitByHeading(body: string): RawSection[] {
	const sections: RawSection[] = [];
	let heading: string | null = null;
	let lines: string[] = [];

	const flush = () => {
		const text = lines.join("\n").trim();
		if (text || heading !== null) sections.push({ heading, text });
	};

	for (const line of body.split("\n")) {
		const m = line.match(HEADING_RE);
		if (m) {
			flush();
			heading = m[2];
			lines = [];
		} else {
			lines.push(line);
		}
	}
	flush();
	return sections;
}

function splitLongSection(
	section: RawSection,
	maxChars: number,
	push: (c: Omit<Chunk, "ord">) => void,
): void {
	if (section.text.length <= maxChars) {
		push({ heading: section.heading, text: section.text });
		return;
	}

	const paragraphs = section.text.split(/\n{2,}/);
	let buf = "";

	const flushBuf = () => {
		const t = buf.trim();
		if (t) push({ heading: section.heading, text: t });
		buf = "";
	};

	for (const p of paragraphs) {
		if (buf.length + p.length + 2 > maxChars && buf.length > 0) {
			flushBuf();
		}
		buf = buf ? buf + "\n\n" + p : p;
		while (buf.length > maxChars) {
			push({ heading: section.heading, text: buf.slice(0, maxChars).trim() });
			buf = buf.slice(maxChars);
		}
	}
	flushBuf();
}

export function chunkBody(body: string, maxChars = MAX_CHUNK_CHARS): Chunk[] {
	if (!body.trim()) return [];

	const chunks: Chunk[] = [];
	let ord = 0;
	const push = (c: Omit<Chunk, "ord">) => {
		if (!c.text.trim()) return;
		chunks.push({ ord: ord++, ...c });
	};

	for (const section of splitByHeading(body)) {
		if (!section.text && !section.heading) continue;
		splitLongSection(section, maxChars, push);
	}
	return chunks;
}
