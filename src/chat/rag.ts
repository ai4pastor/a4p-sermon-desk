import type { HybridHit } from "../search/hybrid";

/** 채팅 한 턴. sources는 assistant 답변의 근거 청크(출처 칩 렌더용). */
export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	sources?: HybridHit[];
}

export interface ApiMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export const MAX_CHUNKS_PER_NOTE = 2;
/** API에 보내는 이전 턴 메시지 수 (6 = Q/A 3쌍). */
export const CHAT_MAX_HISTORY_TURNS = 6;
export const MAX_CHUNK_CHARS = 1500;
export const MAX_CONTEXT_CHARS = 10000;

export const EMPTY_CONTEXT_MARKER = "(관련 노트를 찾지 못했습니다)";

/**
 * 참고 개수 설정(topK)에 맞는 총량 캡.
 * 청크 본문 상한에 항목 머리글([n] 제목 (경로)) 여유분을 더해,
 * 사용자가 고른 개수가 총량 캡 때문에 깎이지 않게 한다.
 */
export function maxContextCharsFor(topK: number): number {
	return topK * (MAX_CHUNK_CHARS + 300);
}

export const CHAT_SYSTEM_PROMPT = `당신은 한국 개신교 목회자의 설교 준비를 돕는 조수입니다.
사용자의 질문 아래에 [노트 자료]로 사용자의 옵시디언 노트에서 검색된 발췌문이 번호와 함께 제공됩니다.

규칙:
- 반드시 [노트 자료]에 근거하여 한국어로 답하세요.
- 자료에 근거한 모든 문장과 목록 항목의 끝에는 반드시 [1] 형식의 출처 번호를 표기하세요. 출처가 여러 개면 [1][2]처럼 각각 따로 표기하세요 ("[1, 2]" 같은 묶음 표기 금지). 출처 표기가 없는 주장이 없어야 합니다.
- 자료에 없는 내용은 "노트에서 찾지 못했습니다"라고 밝히세요. 일반 지식으로 보충할 때는 그것이 노트 밖의 내용임을 분명히 표시하세요.
- 목회자가 설교 준비에 바로 활용할 수 있도록 간결하게, 요점·개요 중심으로 답하세요.
- 답변이 여러 부분으로 나뉠 때는 마크다운 소제목(### 제목)으로 구분하고, 세부 항목은 목록(-)으로 정리하세요.
- 성경 인용과 용어는 자료에 쓰인 표기를 따르세요.`;

/** 노트당 최대 maxPerNote개 청크만 남긴다 (점수순 유지). */
export function capPerNote(
	hits: HybridHit[],
	maxPerNote: number,
): HybridHit[] {
	const counts = new Map<string, number>();
	const out: HybridHit[] = [];
	for (const h of hits) {
		const n = counts.get(h.notePath) ?? 0;
		if (n >= maxPerNote) continue;
		counts.set(h.notePath, n + 1);
		out.push(h);
	}
	return out;
}

/**
 * 인용 표기 괄호 안 문자열을 출처 번호 배열로 해석.
 * "3" → [3], "1, 2" → [1,2], "1-3"·"1~3" → [1,2,3].
 * 하나라도 1..citeMax 범위를 벗어나거나 형식이 다르면 인용이 아닌 것으로 보고 null.
 */
export function parseCiteNumbers(
	raw: string,
	citeMax: number,
): number[] | null {
	if (citeMax <= 0) return null;
	const out: number[] = [];
	for (const tok of raw.split(/[,，·]/)) {
		const t = tok.trim();
		const range = /^(\d{1,2})\s*[-~]\s*(\d{1,2})$/.exec(t);
		if (range) {
			const a = Number(range[1]);
			const b = Number(range[2]);
			if (a < 1 || b > citeMax || b < a) return null;
			for (let n = a; n <= b; n++) out.push(n);
			continue;
		}
		if (!/^\d{1,2}$/.test(t)) return null;
		const n = Number(t);
		if (n < 1 || n > citeMax) return null;
		out.push(n);
	}
	return [...new Set(out)];
}

export interface BuiltContext {
	block: string;
	/** 자료 블록에 실제 포함된 청크 — [n] 번호와 1:1 대응 (출처 표시용). */
	used: HybridHit[];
}

/**
 * 검색 청크들을 [1]…[N] 번호 자료 블록으로 조립.
 * 청크당 MAX_CHUNK_CHARS, 전체 maxChars 캡 — 캡을 넘기는 청크는
 * 통째로 제외한다(중간 절단으로 문맥이 깨지는 것 방지).
 * maxChars 기본값은 MAX_CONTEXT_CHARS이며, 참고 개수 설정이 크면
 * 호출부에서 개수 × MAX_CHUNK_CHARS로 늘려 전달한다.
 */
export function buildContext(
	hits: HybridHit[],
	maxChars: number = MAX_CONTEXT_CHARS,
): BuiltContext {
	if (hits.length === 0) return { block: EMPTY_CONTEXT_MARKER, used: [] };
	const parts: string[] = [];
	const used: HybridHit[] = [];
	let total = 0;
	for (const h of hits) {
		const head = h.heading ? ` › ${h.heading}` : "";
		let text = h.fullText.trim();
		if (text.length > MAX_CHUNK_CHARS) {
			text = `${text.slice(0, MAX_CHUNK_CHARS)}…`;
		}
		const entry = `[${used.length + 1}] ${h.noteTitle}${head} (${h.notePath})\n${text}`;
		if (total + entry.length > maxChars && used.length > 0) break;
		parts.push(entry);
		used.push(h);
		total += entry.length;
	}
	return { block: parts.join("\n\n"), used };
}

export function buildContextBlock(hits: HybridHit[]): string {
	return buildContext(hits).block;
}

/** 이전 턴을 최근 maxMessages개로 자르되, assistant로 시작하지 않게 쌍 경계 유지. */
export function trimHistory(
	messages: ChatMessage[],
	maxMessages: number,
): ChatMessage[] {
	if (messages.length <= maxMessages) return messages.slice();
	let start = messages.length - maxMessages;
	while (start < messages.length && messages[start].role === "assistant") {
		start++;
	}
	return messages.slice(start);
}

/**
 * API에 보낼 메시지 배열 조립.
 * 이전 턴은 표시된 텍스트만(자료 블록 없이), 최신 질문에만 자료 블록을 붙인다.
 */
export function buildChatMessages(
	history: ChatMessage[],
	question: string,
	contextBlock: string,
): ApiMessage[] {
	const msgs: ApiMessage[] = [
		{ role: "system", content: CHAT_SYSTEM_PROMPT },
	];
	for (const m of trimHistory(history, CHAT_MAX_HISTORY_TURNS)) {
		msgs.push({ role: m.role, content: m.content });
	}
	msgs.push({
		role: "user",
		content: `[노트 자료]\n${contextBlock}\n\n[질문]\n${question}`,
	});
	return msgs;
}
