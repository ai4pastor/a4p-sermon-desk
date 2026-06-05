import type { Database } from "sql.js";
import {
	getDistinctTagKeys,
	getEmbeddedKeys,
	upsertKeyEmbedding,
	type KeyEmbeddingTable,
} from "../db/embeddings";
import { embedTexts, EMBEDDING_MODEL } from "./openai";

const STRIP_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}️]/gu;

function stripEmoji(key: string): string {
	return key.replace(STRIP_EMOJI, "").trim();
}

export interface LexiconProgress {
	phase: "doctrine" | "tag";
	done: number;
	total: number;
}

export type ProgressCallback = (p: LexiconProgress) => void;

async function embedKeys(
	db: Database,
	table: KeyEmbeddingTable,
	keys: string[],
	apiKey: string,
	model: string,
	now: number,
	phase: "doctrine" | "tag",
	onProgress?: ProgressCallback,
	synonyms?: Record<string, string[]>,
	rebuild?: boolean,
): Promise<{ embedded: number; skipped: number }> {
	const existing = rebuild ? new Set<string>() : getEmbeddedKeys(db, table, model);
	const missing = keys.filter((k) => k && !existing.has(k));
	const total = missing.length;
	if (total === 0) {
		onProgress?.({ phase, done: 0, total: 0 });
		return { embedded: 0, skipped: keys.length };
	}
	// 키 단어만으론 변별력이 약하다(특히 한자어 교리어). 동의어를 함께 임베딩해
	// 본문 표현과의 코사인을 높인다. 예: "성화" → "성화 거룩해짐 거룩한삶".
	const inputs = missing.map((k) => {
		const base = stripEmoji(k);
		const syns = synonyms?.[k];
		if (!syns || syns.length === 0) return base;
		return `${base} ${syns.map(stripEmoji).join(" ")}`.trim();
	});
	const BATCH = 100;
	let done = 0;
	for (let i = 0; i < inputs.length; i += BATCH) {
		const batchKeys = missing.slice(i, i + BATCH);
		const batchInputs = inputs.slice(i, i + BATCH);
		const vecs = await embedTexts(batchInputs, apiKey);
		for (let j = 0; j < vecs.length; j++) {
			upsertKeyEmbedding(db, table, batchKeys[j], model, vecs[j], now);
		}
		done += vecs.length;
		onProgress?.({ phase, done, total });
	}
	return { embedded: total, skipped: keys.length - total };
}

export async function embedDoctrineKeys(
	db: Database,
	doctrineKeys: string[],
	apiKey: string,
	synonyms: Record<string, string[]>,
	onProgress?: ProgressCallback,
): Promise<{ embedded: number; skipped: number }> {
	// 동의어를 함께 임베딩하므로 입력이 바뀌었다 — 기존 임베딩을 전체 재생성(rebuild).
	return embedKeys(
		db,
		"doctrine_embeddings",
		doctrineKeys,
		apiKey,
		EMBEDDING_MODEL,
		Date.now(),
		"doctrine",
		onProgress,
		synonyms,
		true,
	);
}

export async function embedTagKeys(
	db: Database,
	apiKey: string,
	onProgress?: ProgressCallback,
): Promise<{ embedded: number; skipped: number }> {
	const keys = getDistinctTagKeys(db);
	return embedKeys(
		db,
		"tag_embeddings",
		keys,
		apiKey,
		EMBEDDING_MODEL,
		Date.now(),
		"tag",
		onProgress,
	);
}
