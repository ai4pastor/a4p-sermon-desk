// 검색 결과를 노트에 넣는 방식(링크 | 콜아웃)의 순수 함수들.
// obsidian에 의존하지 않아 vitest로 직접 검증한다. 링크 문자열 생성은
// RecallView.buildWikilink(generateMarkdownLink)가 담당하고 여기서는 조립만 한다.

import type { InsertMode } from "./settings";

/** 카드 버튼·팝업 버튼 공용 라벨. */
export const INSERT_LABEL: Record<InsertMode, string> = {
	link: "🔗 링크 삽입",
	callout: "💬 콜아웃 삽입",
};

/** Option(Alt)을 누른 채 드래그·클릭하면 이번 한 번만 반대 방식. */
export function effectiveInsertMode(
	base: InsertMode,
	altKey: boolean,
): InsertMode {
	if (!altKey) return base;
	return base === "link" ? "callout" : "link";
}

/** 링크 별칭을 깨뜨리는 문자(`[` `]` `|`)를 걷어내고 공백을 압축한다. */
function sanitizeAlias(s: string): string {
	return s.replace(/[[\]|]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 콜아웃 제목 줄 링크의 별칭 "노트제목 › 헤딩".
 * 헤딩이 없으면 undefined → 별칭 없는 [[노트제목]].
 */
export function calloutAlias(
	title: string,
	heading: string | null,
): string | undefined {
	if (!heading) return undefined;
	const h = sanitizeAlias(heading);
	if (!h) return undefined;
	const t = sanitizeAlias(title);
	return t ? `${t} › ${h}` : h;
}

/**
 * 매칭 청크를 `> [!quote]+ <link>` 접기 가능 인용 콜아웃으로 조립한다.
 * 개행 1개로 끝나며 앞 개행은 붙이지 않는다(드롭 위치에 따른 패딩은 호출자 책임).
 */
export function buildCallout(link: string, body: string): string {
	const head = `> [!quote]+ ${link}\n`;
	const text = body
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+$/gm, "")
		.trim();
	if (!text) return head;
	const quoted = text
		.split("\n")
		.map((line) => (line === "" ? ">" : `> ${line}`))
		.join("\n");
	return `${head}${quoted}\n`;
}
