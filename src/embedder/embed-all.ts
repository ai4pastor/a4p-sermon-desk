import type { Database } from "sql.js";
import { embedTexts, EMBEDDING_MODEL } from "./openai";
import {
	getMissingChunks,
	upsertEmbedding,
} from "../db/embeddings";

export interface EmbedProgress {
	done: number;
	total: number;
}

export interface EmbedResult {
	embedded: number;
}

const BATCH = 100;

export async function embedMissingChunks(
	db: Database,
	apiKey: string,
	onProgress?: (p: EmbedProgress) => void,
): Promise<EmbedResult> {
	const missing = getMissingChunks(db, EMBEDDING_MODEL);
	if (missing.length === 0) return { embedded: 0 };

	let embedded = 0;
	for (let i = 0; i < missing.length; i += BATCH) {
		const batch = missing.slice(i, i + BATCH);
		const texts = batch.map((c) => c.text);
		const vecs = await embedTexts(texts, apiKey);
		if (vecs.length !== batch.length) {
			throw new Error(
				`임베딩 응답 개수 불일치: 입력 ${batch.length}, 응답 ${vecs.length}`,
			);
		}
		db.exec("BEGIN");
		try {
			for (let j = 0; j < batch.length; j++) {
				upsertEmbedding(db, batch[j].id, EMBEDDING_MODEL, vecs[j]);
			}
			db.exec("COMMIT");
		} catch (e) {
			db.exec("ROLLBACK");
			throw e;
		}
		embedded += batch.length;
		onProgress?.({ done: embedded, total: missing.length });
	}
	return { embedded };
}
