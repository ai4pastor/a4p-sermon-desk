const OPENAI_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-large";
const DIMENSIONS = 1024;
const BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000;

export const EMBEDDING_MODEL = MODEL;
export const EMBEDDING_DIM = DIMENSIONS;

export class MissingApiKeyError extends Error {
	constructor() {
		super(
			"OpenAI API 키가 설정되지 않았습니다. 설정 → A4P Sermon Desk에서 입력해주세요.",
		);
		this.name = "MissingApiKeyError";
	}
}

export class OpenAIEmbedError extends Error {
	constructor(
		public status: number,
		public detail: string,
	) {
		super(`OpenAI 임베딩 실패 (HTTP ${status}): ${detail}`);
		this.name = "OpenAIEmbedError";
	}
}

interface EmbeddingResponse {
	data: { embedding: number[]; index: number }[];
}

async function postBatch(
	texts: string[],
	apiKey: string,
): Promise<Float32Array[]> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	let res: Response;
	try {
		res = await fetch(OPENAI_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: MODEL,
				dimensions: DIMENSIONS,
				input: texts,
			}),
			signal: ctrl.signal,
		});
	} finally {
		clearTimeout(timer);
	}
	if (!res.ok) {
		const text = await res.text();
		throw new OpenAIEmbedError(res.status, text.slice(0, 200));
	}
	const json = (await res.json()) as EmbeddingResponse;
	if (json.data.length !== texts.length) {
		throw new Error(
			`OpenAI 임베딩 응답 개수 불일치: 입력 ${texts.length}, 응답 ${json.data.length}`,
		);
	}
	json.data.sort((a, b) => a.index - b.index);
	return json.data.map((d) => Float32Array.from(d.embedding));
}

function isRetryable(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			return await fn();
		} catch (e) {
			lastErr = e;
			if (e instanceof OpenAIEmbedError && !isRetryable(e.status)) throw e;
			if (attempt === MAX_RETRIES - 1) break;
			const delayMs = 500 * 2 ** attempt;
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}
	throw lastErr;
}

export async function embedTexts(
	texts: string[],
	apiKey: string,
): Promise<Float32Array[]> {
	if (!apiKey || !apiKey.trim()) throw new MissingApiKeyError();
	if (texts.length === 0) return [];
	const out: Float32Array[] = [];
	for (let i = 0; i < texts.length; i += BATCH_SIZE) {
		const batch = texts.slice(i, i + BATCH_SIZE);
		const vecs = await withRetry(() => postBatch(batch, apiKey));
		out.push(...vecs);
	}
	return out;
}
