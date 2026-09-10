import { MissingApiKeyError } from "./openai";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const CHAT_MODEL = "gpt-4o-mini";
const BATCH = 25;
const TIMEOUT_MS = 60000;
const MAX_RETRIES = 3;

/** 렉시콘의 분야(domain)를 넣은 동의어 생성 시스템 프롬프트. 분야가 비어 있으면 "일반". */
export function systemPrompt(domain: string): string {
	const field = domain.trim() || "일반";
	return `당신은 ${field} 분야의 개념 분류 전문가입니다. 주어진 키워드 각각에 대해, 글 본문에서 그 개념을 가리킬 때 실제로 쓰이는 한국어 표현(동의어·유사 표현)을 3~6개 생성하세요.

규칙:
- 키워드 자체는 동의어 목록에 포함하지 마세요.
- 너무 일반적이거나 광범위한 단어(상위 개념)는 그 키워드를 특정하지 못하므로 피하세요.
- 본문에 자연스럽게 등장할 법한 명사형·동사형 표현으로 작성하세요. (예: "중생" → "거듭남", "새로 태어남"; "정렬" → "얼라인먼트", "가치 정렬")
- 각 표현은 2글자 이상이어야 합니다.

반드시 JSON 객체만 출력하세요. 형식: {"키워드1": ["동의어a","동의어b"], "키워드2": ["동의어c","동의어d"]}`;
}

export interface SynonymProgress {
	done: number;
	total: number;
}

export type SynonymProgressCallback = (p: SynonymProgress) => void;

interface ChatResponse {
	choices?: { message?: { content?: string } }[];
}

function isRetryable(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
}

async function requestBatch(
	keys: string[],
	apiKey: string,
	domain: string,
): Promise<Record<string, string[]>> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	let res: Response;
	try {
		res = await fetch(CHAT_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: CHAT_MODEL,
				temperature: 0.3,
				response_format: { type: "json_object" },
				messages: [
					{ role: "system", content: systemPrompt(domain) },
					{
						role: "user",
						content: `다음 키워드들의 동의어를 생성하세요:\n${keys.join("\n")}`,
					},
				],
			}),
			signal: ctrl.signal,
		});
	} finally {
		clearTimeout(timer);
	}
	if (!res.ok) {
		const text = await res.text();
		const err = new Error(
			`OpenAI 동의어 생성 실패 (HTTP ${res.status}): ${text.slice(0, 200)}`,
		);
		(err as Error & { status?: number }).status = res.status;
		throw err;
	}
	const json = (await res.json()) as ChatResponse;
	const content = json.choices?.[0]?.message?.content ?? "{}";
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return {};
	}
	const out: Record<string, string[]> = {};
	if (parsed && typeof parsed === "object") {
		for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
			if (!Array.isArray(v)) continue;
			const syns = v
				.filter((s): s is string => typeof s === "string")
				.map((s) => s.trim())
				.filter((s) => s.length >= 2 && s !== k);
			if (syns.length) out[k] = syns;
		}
	}
	return out;
}

async function requestBatchWithRetry(
	keys: string[],
	apiKey: string,
	domain: string,
): Promise<Record<string, string[]>> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			return await requestBatch(keys, apiKey, domain);
		} catch (e) {
			lastErr = e;
			const status = (e as Error & { status?: number }).status;
			if (typeof status === "number" && !isRetryable(status)) throw e;
			if (attempt === MAX_RETRIES - 1) break;
			await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
		}
	}
	throw lastErr;
}

/** 동의어가 없는 키워드만 배치 생성해 existing에 합친다. domain은 렉시콘의 분야. */
export async function generateSynonyms(
	keys: string[],
	apiKey: string,
	existing: Record<string, string[]>,
	domain: string,
	onProgress?: SynonymProgressCallback,
): Promise<Record<string, string[]>> {
	if (!apiKey || !apiKey.trim()) throw new MissingApiKeyError();
	const result: Record<string, string[]> = { ...existing };
	const missing = keys.filter(
		(k) => k && !(existing[k] && existing[k].length > 0),
	);
	const total = missing.length;
	if (total === 0) {
		onProgress?.({ done: 0, total: 0 });
		return result;
	}
	let done = 0;
	for (let i = 0; i < missing.length; i += BATCH) {
		const batch = missing.slice(i, i + BATCH);
		const map = await requestBatchWithRetry(batch, apiKey, domain);
		for (const k of batch) {
			if (map[k] && map[k].length > 0) result[k] = map[k];
		}
		done += batch.length;
		onProgress?.({ done, total });
	}
	return result;
}
