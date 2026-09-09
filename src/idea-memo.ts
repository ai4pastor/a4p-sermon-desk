// 선택 텍스트로 아이디어 메모(새 노트)를 조립하는 순수 함수들.
// obsidian에 의존하지 않아 vitest로 직접 검증한다. 원본 링크 문자열은
// 호출자(idea-memo-create.ts, generateMarkdownLink)가 만들고 여기서는 제목·경로·본문만 조립한다.

import { buildCallout } from "./insert";

/** 파일명으로 쓰는 제목의 최대 길이. */
export const IDEA_TITLE_MAX = 40;
/** 40자에서 자를 때 단어 경계로 후퇴하되 최소 이만큼은 남긴다. */
const IDEA_TITLE_MIN_KEEP = 20;

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

/** 로컬 시각 YYYY-MM-DDTHH:mm — 볼트 frontmatter 날짜 규칙. */
export function formatFmDate(d: Date): string {
	return (
		`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
		`T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
	);
}

/** 큰따옴표로 감싸고 \ " 를 이스케이프 — 위키링크·마크다운 링크 모두 YAML 안전. */
export function yamlQuote(s: string): string {
	return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * 선택 텍스트의 첫 줄에서 파일명으로 쓸 제목을 만든다.
 * 마크다운 장식(인용·헤딩·목록·콜아웃 마커, 위키링크 괄호, 강조 기호)과
 * 파일명 금지 문자를 걷어내고 40자 내로 자른다. 비면 `아이디어 YYYY-MM-DD HHmm`.
 */
export function deriveIdeaTitle(selection: string, now: Date): string {
	const firstLine =
		selection
			.replace(/\r\n?/g, "\n")
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.length > 0) ?? "";
	let t = firstLine
		// 선두 마커: 인용 >(여러 겹) → 헤딩 # → 목록 - * + / 1. → 콜아웃 [!type]±
		.replace(/^(?:>\s*)+/, "")
		.replace(/^#+\s*/, "")
		.replace(/^(?:[-*+]|\d+[.)])\s+/, "")
		.replace(/^\[![^\]]*\][+-]?\s*/, "")
		// 위키링크 [[a|b]] → b, [[a]] → a
		.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
		.replace(/\[\[([^\]]*)\]\]/g, "$1")
		// 강조·하이라이트 기호
		.replace(/\*\*|__|==|~~/g, "")
		// 파일명 금지 문자
		.replace(/[\\/:*?"<>|#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[.\s]+$/, "");
	if (t.length > IDEA_TITLE_MAX) {
		const cut = t.slice(0, IDEA_TITLE_MAX);
		const sp = cut.lastIndexOf(" ");
		t = (sp >= IDEA_TITLE_MIN_KEEP ? cut.slice(0, sp) : cut).replace(
			/[.\s]+$/,
			"",
		);
	}
	if (!t) {
		const d = formatFmDate(now);
		return `아이디어 ${d.slice(0, 10)} ${d.slice(11, 13)}${d.slice(14, 16)}`;
	}
	return t;
}

/**
 * `${folder}/${title}.md`, 이미 있으면 `${title} 2.md`, `3`… 중 첫 빈 경로.
 * folder는 끝 슬래시 유무 모두 허용(FolderSuggest는 `path/`로 넣는다). 빈 folder = 볼트 루트.
 */
export function uniqueIdeaPath(
	folder: string,
	title: string,
	exists: (path: string) => boolean,
): string {
	const dir = folder.replace(/\/+$/, "");
	const base = dir ? `${dir}/${title}` : title;
	let candidate = `${base}.md`;
	for (let n = 2; exists(candidate); n++) {
		candidate = `${base} ${n}.md`;
	}
	return candidate;
}

export interface IdeaMemoInput {
	selection: string;
	/** 원본 노트 링크(호출자가 generateMarkdownLink로 생성). ""이면 source 줄과 콜아웃 제목 링크를 생략. */
	sourceLink: string;
	calloutType: string;
	now: Date;
}

/**
 * 아이디어 메모 본문: frontmatter(created/modified/source?) + 빈 줄 + 인용 콜아웃 + 빈 줄 1개.
 * 끝의 빈 줄은 템플릿 실행 시 커서 착지점 — 템플릿 출력이 콜아웃을 쪼개지 않게 한다.
 */
export function composeIdeaMemo(input: IdeaMemoInput): string {
	const stamp = formatFmDate(input.now);
	const fm = [`created: ${stamp}`, `modified: ${stamp}`];
	if (input.sourceLink) fm.push(`source: ${yamlQuote(input.sourceLink)}`);
	const callout = buildCallout(
		input.sourceLink,
		input.selection,
		input.calloutType,
	);
	return `---\n${fm.join("\n")}\n---\n\n${callout}\n`;
}
