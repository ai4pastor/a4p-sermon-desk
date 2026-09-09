// 커서 주변 문단 추출 — 순수 함수(obsidian 미의존, 테스트 가능).
// RecallView(자동 검색)·main.ts(명령·우클릭 메뉴)가 공유한다.

/**
 * `line`을 포함하는, 빈 줄로 둘러싸인 문단을 돌려준다(양끝 공백 제거).
 * 커서 줄 자체가 빈 줄이면 ""(이웃 두 문단을 합쳐 버리지 않는다).
 */
export function paragraphAround(
	lines: readonly string[],
	line: number,
): string {
	if (lines.length === 0) return "";
	const at = Math.max(0, Math.min(lines.length - 1, line));
	if (lines[at].trim() === "") return "";
	let start = at;
	let end = at;
	while (start > 0 && lines[start - 1].trim() !== "") start--;
	while (end < lines.length - 1 && lines[end + 1].trim() !== "") end++;
	return lines.slice(start, end + 1).join("\n").trim();
}
