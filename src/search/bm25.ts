import type { Database } from "sql.js";

export interface BM25Hit {
	chunkId: number;
	score: number;
}

const K1 = 1.2;
const B = 0.75;

interface Bm25Stats {
	N: number;
	avgdl: number;
	dlMap: Map<number, number>;
	/** 청크 id → 노트 경로. 활성 프로파일 0점 노트를 후보 단계에서 거르는 술어용. */
	notePath: Map<number, string>;
}

// 문서 통계(N·avgdl·문서길이 맵) 캐시 — 매 쿼리 전체 집계를 피한다.
// chunks는 UPDATE 없이 delete+insert(AUTOINCREMENT)라 COUNT+MAX(id)로 감지되고,
// chunk_terms만 바뀌는 경우(보호 단어 재계산)는 chunk_terms COUNT로 감지된다.
let statsCache: { fp: string; stats: Bm25Stats } | null = null;

function chunksFingerprint(db: Database): string {
	const r = db.exec(
		"SELECT COUNT(*), MAX(id), (SELECT COUNT(*) FROM chunk_terms) FROM chunks",
	);
	const row = r[0]?.values[0];
	return row ? `${row[0]}:${row[1]}:${row[2]}` : "0:null:0";
}

function loadStats(db: Database): Bm25Stats {
	const nRow = db.exec("SELECT COUNT(*) FROM chunks")[0];
	const N = nRow ? Number(nRow.values[0][0]) : 0;

	const totalRow = db.exec("SELECT COUNT(*) FROM chunk_terms")[0];
	const totalTerms = totalRow ? Number(totalRow.values[0][0]) : 0;

	const dlMap = new Map<number, number>();
	const dlRes = db.exec(
		"SELECT chunk_id, COUNT(*) FROM chunk_terms GROUP BY chunk_id",
	);
	if (dlRes[0]) {
		for (const row of dlRes[0].values) {
			dlMap.set(Number(row[0]), Number(row[1]));
		}
	}
	const notePath = new Map<number, string>();
	const npRes = db.exec("SELECT id, note_path FROM chunks");
	if (npRes[0]) {
		for (const row of npRes[0].values) {
			notePath.set(Number(row[0]), String(row[1]));
		}
	}
	return { N, avgdl: N > 0 ? totalTerms / N : 0, dlMap, notePath };
}

/**
 * @param allow 노트 경로 술어 — false를 반환한 노트의 청크는 topK 자르기 전에
 *   제외된다(활성 테마 프로파일 0점 노트가 후보 슬롯을 소모하지 않도록).
 *   미지정 시 전 청크가 후보. df/idf는 항상 전 청크 기준(프로파일 간 안정).
 */
export function bm25Search(
	db: Database,
	queryTerms: string[],
	topK: number,
	allow?: (notePath: string) => boolean,
): BM25Hit[] {
	const uniqueTerms = Array.from(new Set(queryTerms.filter((t) => t.length > 0)));
	if (uniqueTerms.length === 0) return [];

	const fp = chunksFingerprint(db);
	if (!statsCache || statsCache.fp !== fp) {
		statsCache = { fp, stats: loadStats(db) };
	}
	const { N, avgdl, dlMap, notePath } = statsCache.stats;
	if (N === 0 || avgdl === 0) return [];

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
			if (allow && !allow(notePath.get(chunkId) ?? "")) continue;
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
