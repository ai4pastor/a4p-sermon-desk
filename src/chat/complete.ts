import { MissingApiKeyError } from "../embedder/openai";
import type { ApiMessage } from "./rag";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 60000;
const MAX_RETRIES = 3;
const MAX_COMPLETION_TOKENS = 2048;

export class OpenAIChatError extends Error {
	status: number;
	detail: string;
	constructor(status: number, detail: string) {
		super(`OpenAI 채팅 응답 실패 (HTTP ${status}): ${detail}`);
		this.name = "OpenAIChatError";
		this.status = status;
		this.detail = detail;
	}
}

interface ChatResponse {
	choices?: { message?: { content?: string } }[];
}

function isRetryable(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
}

async function requestOnce(
	messages: ApiMessage[],
	model: string,
	apiKey: string,
	signal?: AbortSignal,
): Promise<string> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	const onOuterAbort = () => ctrl.abort();
	signal?.addEventListener("abort", onOuterAbort, { once: true });
	let res: Response;
	try {
		res = await fetch(CHAT_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
				max_completion_tokens: MAX_COMPLETION_TOKENS,
				// gpt-5 계열은 reasoning 지연이 크므로 낮춰 채팅 응답성 확보.
				// (temperature는 gpt-5 계열이 비기본값을 거부하므로 보내지 않는다.)
				...(model.startsWith("gpt-5")
					? { reasoning_effort: "low" }
					: {}),
			}),
			signal: ctrl.signal,
		});
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onOuterAbort);
	}
	if (!res.ok) {
		const text = await res.text();
		throw new OpenAIChatError(res.status, text.slice(0, 300));
	}
	const json = (await res.json()) as ChatResponse;
	const content = json.choices?.[0]?.message?.content ?? "";
	if (!content.trim()) {
		throw new OpenAIChatError(0, "모델이 빈 응답을 반환했습니다");
	}
	return content;
}

/** 노트 기반 채팅 완성 호출. 429/5xx는 지수 백오프로 최대 3회 재시도. */
export async function chatComplete(
	messages: ApiMessage[],
	model: string,
	apiKey: string,
	signal?: AbortSignal,
): Promise<string> {
	if (!apiKey || !apiKey.trim()) throw new MissingApiKeyError();
	let lastErr: unknown;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			return await requestOnce(messages, model, apiKey, signal);
		} catch (e) {
			lastErr = e;
			// 사용자가 취소(새 대화·뷰 닫기)한 요청은 재시도하지 않는다.
			if (signal?.aborted) throw e;
			// 4xx(429 제외)는 재시도 무의미. 네트워크 오류·타임아웃은 재시도.
			if (e instanceof OpenAIChatError && !isRetryable(e.status)) {
				throw e;
			}
			if (attempt === MAX_RETRIES - 1) break;
			await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
		}
	}
	throw lastErr;
}
