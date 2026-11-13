// 오래 걸리는 형태소 색인 재계산의 시간 안내 — 설정 탭 예상과 진행 알림의 남은 시간.

/**
 * 재계산 예상에 쓰는 청크당 시간(초). 실측: 노트 2,749개·청크 4,480개를 옵시디언에서 45분
 * (≈0.6초/청크, 같은 작업이 Node에서는 13분). 넉넉한 쪽 값이라 안내는 "길게는"으로 쓴다.
 */
export const RETOKENIZE_SEC_PER_CHUNK = 0.6;

/** 분 → "약 N분" / "약 H시간" / "약 H시간 M분" (최소 1분). */
export function formatDuration(minutes: number): string {
	const m = Math.max(1, Math.round(minutes));
	if (m < 60) return `약 ${m}분`;
	const h = Math.floor(m / 60);
	const r = m % 60;
	return r === 0 ? `약 ${h}시간` : `약 ${h}시간 ${r}분`;
}

/** 청크 수로 본 재계산 예상 — 설정 탭 안내 문구. */
export function retokenizeEstimate(chunks: number): string {
	const minutes = (chunks * RETOKENIZE_SEC_PER_CHUNK) / 60;
	return minutes < 1
		? "1분 안에 끝납니다"
		: `길게는 ${formatDuration(minutes)} 걸릴 수 있습니다`;
}

/** 이번 실행의 처리 속도로 본 남은 시간. 처리한 청크가 50개 미만이면 null(추정이 흔들린다). */
export function remainingText(
	processed: number,
	elapsedMs: number,
	remaining: number,
): string | null {
	if (processed < 50 || elapsedMs <= 0 || remaining <= 0) return null;
	const minutes = ((elapsedMs / processed) * remaining) / 60_000;
	return minutes < 1 ? "곧 끝남" : `${formatDuration(minutes)} 남음`;
}
