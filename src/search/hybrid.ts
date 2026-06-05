import type { Database } from "sql.js";
import { vectorSearch } from "./vector";
import { bm25Search } from "./bm25";
import { EMBEDDING_MODEL } from "../embedder/openai";

export interface HybridHit {
	chunkId: number;
	notePath: string;
	noteTitle: string;
	heading: string | null;
	preview: string;
	fullText: string;
	categoryId: string;
	noteWeight: number;
	rrfScore: number;
	finalScore: number;
	bm25Rank: number | null;
	vectorRank: number | null;
	bm25Score: number | null;
	vectorScore: number | null;
	headingMatched: boolean;
	matchedQueryTerms: number;
	queryTermsTotal: number;
}

export interface HybridOptions {
	topN?: number;
	candidateK?: number;
	applyWeight?: boolean;
	applyHeadingBoost?: boolean;
	applyOverlapBoost?: boolean;
}

const RRF_K = 60;
const HEADING_BOOST = 1.2;
const OVERLAP_FACTOR = 0.5;
const VECTOR_NOISE_THRESHOLD = 0.6;
const MIN_REQUIRED_MATCH = 2;
const DEFAULT_CANDIDATE_K = 30;
const DEFAULT_TOP_N = 10;

export function hybridSearch(
	db: Database,
	queryTerms: string[],
	queryEmbedding: Float32Array | null,
	opts: HybridOptions = {},
): HybridHit[] {
	const topN = opts.topN ?? DEFAULT_TOP_N;
	const candidateK = opts.candidateK ?? DEFAULT_CANDIDATE_K;
	const applyWeight = opts.applyWeight ?? true;
	const applyHeadingBoost = opts.applyHeadingBoost ?? true;
	const applyOverlapBoost = opts.applyOverlapBoost ?? true;

	const uniqueTerms = Array.from(
		new Set(queryTerms.filter((t) => t.length > 0)),
	);

	const bm25Hits = bm25Search(db, queryTerms, candidateK);
	const vectorHits = queryEmbedding
		? vectorSearch(db, queryEmbedding, EMBEDDING_MODEL, candidateK)
		: [];

	if (bm25Hits.length === 0 && vectorHits.length === 0) return [];

	interface Entry {
		rrfScore: number;
		bm25Rank: number | null;
		vectorRank: number | null;
		bm25Score: number | null;
		vectorScore: number | null;
	}
	const rrfMap = new Map<number, Entry>();

	bm25Hits.forEach((h, i) => {
		const rank = i + 1;
		const score = 1 / (RRF_K + rank);
		const ex = rrfMap.get(h.chunkId);
		if (ex) {
			ex.rrfScore += score;
			ex.bm25Rank = rank;
			ex.bm25Score = h.score;
		} else {
			rrfMap.set(h.chunkId, {
				rrfScore: score,
				bm25Rank: rank,
				vectorRank: null,
				bm25Score: h.score,
				vectorScore: null,
			});
		}
	});

	vectorHits.forEach((h) => {
		const rank = h.rank;
		const score = 1 / (RRF_K + rank);
		const ex = rrfMap.get(h.chunkId);
		if (ex) {
			ex.rrfScore += score;
			ex.vectorRank = rank;
			ex.vectorScore = h.similarity;
		} else {
			rrfMap.set(h.chunkId, {
				rrfScore: score,
				bm25Rank: null,
				vectorRank: rank,
				bm25Score: null,
				vectorScore: h.similarity,
			});
		}
	});

	const chunkIds = Array.from(rrfMap.keys());
	if (chunkIds.length === 0) return [];

	const placeholders = chunkIds.map(() => "?").join(",");
	const rows = db.exec(
		`SELECT c.id, c.note_path, c.heading, SUBSTR(c.text, 1, 80), c.text, n.category_id, n.weight
		 FROM chunks c JOIN notes n ON c.note_path = n.path
		 WHERE c.id IN (${placeholders})`,
		chunkIds,
	);

	const matchedMap = new Map<number, number>();
	if (uniqueTerms.length > 0) {
		const termPlaceholders = uniqueTerms.map(() => "?").join(",");
		const matchRes = db.exec(
			`SELECT chunk_id, COUNT(DISTINCT term)
			 FROM chunk_terms
			 WHERE chunk_id IN (${placeholders})
			   AND term IN (${termPlaceholders})
			 GROUP BY chunk_id`,
			[...chunkIds, ...uniqueTerms],
		);
		if (matchRes[0]) {
			for (const row of matchRes[0].values) {
				matchedMap.set(Number(row[0]), Number(row[1]));
			}
		}
	}

	const hits: HybridHit[] = [];
	if (rows[0]) {
		for (const r of rows[0].values) {
			const chunkId = Number(r[0]);
			const notePath = String(r[1]);
			const heading = r[2] === null ? null : String(r[2]);
			const preview = String(r[3] ?? "");
			const fullText = String(r[4] ?? "");
			const categoryId = String(r[5]);
			const noteWeight = Number(r[6]);
			const entry = rrfMap.get(chunkId);
			if (!entry) continue;

			const headingMatched = heading
				? queryTerms.some((t) => t.length > 0 && heading.includes(t))
				: false;

			const matched = matchedMap.get(chunkId) ?? 0;
			const coverage =
				uniqueTerms.length > 0 ? matched / uniqueTerms.length : 0;

			let finalScore = entry.rrfScore;
			if (applyWeight) finalScore *= noteWeight;
			if (applyHeadingBoost && headingMatched) finalScore *= HEADING_BOOST;
			if (applyOverlapBoost) finalScore *= 1 + coverage * OVERLAP_FACTOR;

			const noteTitle =
				notePath.split("/").pop()?.replace(/\.md$/, "") ?? notePath;

			hits.push({
				chunkId,
				notePath,
				noteTitle,
				heading,
				preview,
				fullText,
				categoryId,
				noteWeight,
				rrfScore: entry.rrfScore,
				finalScore,
				bm25Rank: entry.bm25Rank,
				vectorRank: entry.vectorRank,
				bm25Score: entry.bm25Score,
				vectorScore: entry.vectorScore,
				headingMatched,
				matchedQueryTerms: matched,
				queryTermsTotal: uniqueTerms.length,
			});
		}
	}

	const filtered = hits.filter((h) => {
		const required = Math.min(MIN_REQUIRED_MATCH, h.queryTermsTotal);
		return (
			h.matchedQueryTerms >= required ||
			(h.vectorScore !== null && h.vectorScore >= VECTOR_NOISE_THRESHOLD)
		);
	});
	filtered.sort((a, b) => b.finalScore - a.finalScore);
	return filtered.slice(0, topN);
}
