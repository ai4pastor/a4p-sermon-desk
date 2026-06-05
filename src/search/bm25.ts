import type { Database } from "sql.js";

export interface BM25Hit {
	chunkId: number;
	score: number;
}

const K1 = 1.2;
const B = 0.75;

export function bm25Search(
	db: Database,
	queryTerms: string[],
	topK: number,
): BM25Hit[] {
	const uniqueTerms = Array.from(new Set(queryTerms.filter((t) => t.length > 0)));
	if (uniqueTerms.length === 0) return [];

	const nRow = db.exec("SELECT COUNT(*) FROM chunks")[0];
	const N = nRow ? Number(nRow.values[0][0]) : 0;
	if (N === 0) return [];

	const totalRow = db.exec("SELECT COUNT(*) FROM chunk_terms")[0];
	const totalTerms = totalRow ? Number(totalRow.values[0][0]) : 0;
	if (totalTerms === 0) return [];
	const avgdl = totalTerms / N;

	const dlMap = new Map<number, number>();
	const dlRes = db.exec(
		"SELECT chunk_id, COUNT(*) FROM chunk_terms GROUP BY chunk_id",
	);
	if (dlRes[0]) {
		for (const row of dlRes[0].values) {
			dlMap.set(Number(row[0]), Number(row[1]));
		}
	}

	const dfMap = new Map<string, number>();
	const dfStmt = db.prepare(
		"SELECT COUNT(DISTINCT chunk_id) FROM chunk_terms WHERE term = ?",
	);
	try {
		for (const term of uniqueTerms) {
			dfStmt.bind([term]);
			let df = 0;
			if (dfStmt.step()) df = Number(dfStmt.get()[0]);
			dfMap.set(term, df);
			dfStmt.reset();
		}
	} finally {
		dfStmt.free();
	}

	const placeholders = uniqueTerms.map(() => "?").join(",");
	const tfRes = db.exec(
		`SELECT chunk_id, term, COUNT(*) FROM chunk_terms WHERE term IN (${placeholders}) GROUP BY chunk_id, term`,
		uniqueTerms,
	);

	const scoreMap = new Map<number, number>();
	if (tfRes[0]) {
		for (const row of tfRes[0].values) {
			const chunkId = Number(row[0]);
			const term = row[1] as string;
			const tf = Number(row[2]);
			const df = dfMap.get(term) ?? 0;
			if (df === 0) continue;
			const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
			const dl = dlMap.get(chunkId) ?? avgdl;
			const norm =
				(tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl) / avgdl));
			scoreMap.set(chunkId, (scoreMap.get(chunkId) ?? 0) + idf * norm);
		}
	}

	return Array.from(scoreMap.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, topK)
		.map(([chunkId, score]) => ({ chunkId, score }));
}
