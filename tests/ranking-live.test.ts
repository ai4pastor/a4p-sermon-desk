// 실측 검증 하니스 (opt-in) — 실제 index.db "사본"으로 hybridSearch/tagSearch를
// 노드에서 직접 실행해, 폴더 가중치가 검색 결과에 실제로 반영되는지 수치로 검증한다.
//
// 실행:
//   A4P_LIVE_DB=<index.db 사본 경로> [A4P_SMOKE_OPENAI_KEY=sk-...] [A4P_LIVE_DATA=<data.json 경로>] npm test
//
// 규칙:
//   - A4P_LIVE_DB 파일은 읽기만 한다(쓰기 없음). sql.js는 인메모리로만 동작 —
//     UPDATE는 메모리 사본에만 적용되고 파일은 불변. 반드시 원본이 아닌 사본을 넘길 것.
//   - 쿼리 임베딩은 A4P_LIVE_DB 옆 <파일명>.query-cache.json에 캐시(재실행 시 API 0회).
//   - API 키·data.json 내용은 절대 출력하지 않는다.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("obsidian", () => ({
	normalizePath: (p: string) => p.replace(/\/+/g, "/"),
	Notice: class {},
	Plugin: class {},
	App: class {},
	TFile: class {},
}));
// src/morpheme는 esbuild 바이너리 로더(wasm import)라 노드에서 로드 불가 →
// 동일 로직의 노드용 실제 garu 토크나이저로 대체(가짜 아님).
vi.mock("../src/morpheme", async () => {
	const g = await import("./helpers/garu-node");
	return {
		tokenize: g.tokenizeReal,
		hasHangul: (s: string) => /[ㄱ-ㆎ가-힣]/.test(s),
		isStopword: () => false,
		preloadMorpheme: async () => {},
		destroyMorpheme: () => {},
	};
});

import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import type { App } from "obsidian";
import { hybridSearch, type HybridHit } from "../src/search/hybrid";
import {
	tagSearch,
	loadSearchLexicons,
	extractQueryKeysWithSynonyms,
	buildSynonymTokenIndex,
	VEC_THRESHOLD_DOCTRINE,
	VEC_THRESHOLD_TAG,
	VEC_TOPK,
	type QueryKeys,
	type SearchLexicons,
} from "../src/search/tag";
import { topVectorKeys } from "../src/search/vector";
import { loadAllKeyEmbeddings } from "../src/db/embeddings";
import { EMBEDDING_MODEL, embedTexts } from "../src/embedder/openai";
import { tokenizeReal } from "./helpers/garu-node";

const LIVE_DB = process.env.A4P_LIVE_DB ?? "";
const API_KEY = process.env.A4P_SMOKE_OPENAI_KEY ?? "";
const DATA_JSON = process.env.A4P_LIVE_DATA ?? "";

const QUERIES = [
	{ id: "doctrine-exact", text: "칭의란 무엇인가" },
	{ id: "doctrine-syn", text: "의롭다 하심을 얻는 은혜" },
	{ id: "vec-discovery", text: "거룩해지는 삶" },
	{ id: "tag-exact", text: "#감사" },
	{ id: "vector-only", text: "돌아온 둘째 아들을 안아주는 아버지" },
	{ id: "noise", text: "오늘 점심 메뉴 추천" },
	{ id: "dedupe-series", text: "시편 23편의 목자" },
	{ id: "df-zero", text: "AI 시대의 회개" },
] as const;

const appStub = {} as unknown as App;

let db: Database | null = null;
let lexicons: SearchLexicons | null = null;
let synonymIndex: Map<string, string[][]> = new Map();
const tokensByQuery = new Map<string, string[]>();
const embByQuery = new Map<string, Float32Array>();
const keysByQuery = new Map<string, QueryKeys>();
const report: string[] = [];

function relClose(a: number, b: number, tol = 1e-6): boolean {
	const denom = Math.max(Math.abs(a), Math.abs(b), 1e-12);
	return Math.abs(a - b) / denom < tol;
}

function expectedFinal(h: HybridHit, w: number): number {
	const coverage =
		h.queryTermsTotal > 0 ? h.matchedQueryTerms / h.queryTermsTotal : 0;
	return h.rrfScore * w * (h.headingMatched ? 1.2 : 1) * (1 + coverage * 0.5);
}

function baseName(p: string): string {
	return p.split("/").pop() ?? p;
}

function runHybrid(id: string, topN = 50): HybridHit[] {
	if (!db) throw new Error("db 미초기화");
	return hybridSearch(
		db,
		tokensByQuery.get(id) ?? [],
		embByQuery.get(id) ?? null,
		{ topN },
	);
}

function setFolderWeight(folder: string, w: number): void {
	if (!db) throw new Error("db 미초기화");
	db.run("UPDATE notes SET weight = ? WHERE path LIKE ?", [w, `${folder}/%`]);
}

function snapshotFolderWeights(folder: string): Map<string, number> {
	if (!db) throw new Error("db 미초기화");
	const out = new Map<string, number>();
	const rows = db.exec("SELECT path, weight FROM notes WHERE path LIKE ?", [
		`${folder}/%`,
	]);
	if (rows[0]) {
		for (const r of rows[0].values) out.set(String(r[0]), Number(r[1]));
	}
	return out;
}

function restoreWeights(snapshot: Map<string, number>): void {
	if (!db) throw new Error("db 미초기화");
	for (const [p, w] of snapshot) {
		db.run("UPDATE notes SET weight = ? WHERE path = ?", [w, p]);
	}
}

describe.skipIf(!LIVE_DB)("실측 하니스 (실제 index.db 사본)", () => {
	beforeAll(async () => {
		const bytes = fs.readFileSync(LIVE_DB);
		const SQL = await initSqlJs({
			locateFile: (f: string) =>
				path.resolve(process.cwd(), "node_modules/sql.js/dist", f),
		});
		db = new SQL.Database(bytes);
		lexicons = loadSearchLexicons(db);

		if (DATA_JSON) {
			// doctrineSynonyms 필드만 사용. 다른 내용(API 키 등)은 읽지도 출력하지도 않는다.
			const raw = JSON.parse(fs.readFileSync(DATA_JSON, "utf8")) as {
				doctrineSynonyms?: Record<string, string[]>;
			};
			synonymIndex = await buildSynonymTokenIndex(
				raw.doctrineSynonyms ?? {},
			);
		}

		for (const q of QUERIES) {
			tokensByQuery.set(q.id, await tokenizeReal(q.text));
			keysByQuery.set(
				q.id,
				await extractQueryKeysWithSynonyms(
					q.text,
					lexicons,
					synonymIndex,
				),
			);
		}

		// 쿼리 임베딩: 캐시 우선, 없고 키가 있으면 API 호출 후 캐시 저장.
		const cachePath = `${LIVE_DB}.query-cache.json`;
		let cache: Record<string, number[]> = {};
		if (fs.existsSync(cachePath)) {
			cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
		}
		const missing = QUERIES.filter((q) => !cache[q.text]);
		if (missing.length > 0 && API_KEY) {
			const vecs = await embedTexts(
				missing.map((q) => q.text),
				API_KEY,
			);
			missing.forEach((q, i) => {
				cache[q.text] = Array.from(vecs[i]);
			});
			fs.writeFileSync(cachePath, JSON.stringify(cache));
		}
		for (const q of QUERIES) {
			const arr = cache[q.text];
			if (arr) embByQuery.set(q.id, Float32Array.from(arr));
		}

		const counts = db.exec(
			"SELECT (SELECT COUNT(*) FROM notes), (SELECT COUNT(*) FROM chunks), (SELECT COUNT(*) FROM embeddings)",
		)[0].values[0];
		report.push(
			`[env] notes=${counts[0]} chunks=${counts[1]} embeddings=${counts[2]} | 임베딩 사용: ${embByQuery.size}/${QUERIES.length}쿼리 | 동의어 인덱스: ${synonymIndex.size}키`,
		);
	}, 300_000);

	afterAll(() => {
		// vitest run 모드가 console 출력을 삼키는 경우가 있어 파일로도 남긴다.
		const text = `===== 실측 리포트 (${new Date().toISOString()}) =====\n${report.join("\n")}\n`;
		fs.writeFileSync(`${LIVE_DB}.report.txt`, text);
		// eslint-disable-next-line no-console
		console.log(`\n${text}`);
		db?.close();
	});

	it("점수식 불변식 — 모든 히트의 finalScore = rrf × weight × 헤딩 × (1+coverage×0.5)", () => {
		let checked = 0;
		for (const q of QUERIES) {
			for (const h of runHybrid(q.id)) {
				expect(
					relClose(h.finalScore, expectedFinal(h, h.noteWeight)),
					`${q.id} ${h.notePath} f=${h.finalScore} 기대=${expectedFinal(h, h.noteWeight)}`,
				).toBe(true);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(0);
		report.push(`[점수식] ${checked}개 히트 전부 공식 일치`);
	});

	it("가중치 A/B — 의미 검색: 극단 변경이 순위를 지배하고, 0이면 소멸", () => {
		// 결과가 충분한 첫 쿼리 선택
		const q = QUERIES.find((q) => runHybrid(q.id).length >= 3);
		expect(q, "결과 3개 이상인 쿼리가 없음").toBeDefined();
		if (!q) return;
		const base = runHybrid(q.id, 200);
		const target = base.find((h) => h.notePath.includes("/"));
		expect(target).toBeDefined();
		if (!target) return;
		const folder = target.notePath.slice(
			0,
			target.notePath.lastIndexOf("/"),
		);
		const snapshot = snapshotFolderWeights(folder);
		expect(snapshot.size).toBeGreaterThan(0);
		const isTarget = (p: string) => p.startsWith(`${folder}/`);
		const baseW = new Map(base.map((h) => [h.chunkId, h.noteWeight]));

		try {
			setFolderWeight(folder, 1.5); // UI 10 상당
			const hi = runHybrid(q.id, 200);
			setFolderWeight(folder, 0.15); // UI 1 상당
			const lo = runHybrid(q.id, 200);
			setFolderWeight(folder, 0);
			const zero = runHybrid(q.id, 200);

			// (a) 대상 노트: finalScore가 정확히 새 가중치 배율로 변함 (부스트는 동일해 소거)
			for (const h of hi.filter((h) => isTarget(h.notePath))) {
				const w0 = baseW.get(h.chunkId);
				if (w0 === undefined || w0 === 0) continue;
				const b = base.find((x) => x.chunkId === h.chunkId);
				if (!b) continue;
				expect(
					relClose(h.finalScore / b.finalScore, 1.5 / w0),
					`10점 배율 불일치: ${h.notePath}`,
				).toBe(true);
			}
			// (b) 비대상 노트: 점수 불변
			for (const h of hi.filter((h) => !isTarget(h.notePath))) {
				const b = base.find((x) => x.chunkId === h.chunkId);
				if (!b) continue;
				expect(
					relClose(h.finalScore, b.finalScore),
					`비대상 점수 변동: ${h.notePath}`,
				).toBe(true);
			}
			// (c) weight 0: 대상 폴더 완전 소멸
			expect(zero.some((h) => isTarget(h.notePath))).toBe(false);
			// (d) 10 → 1 단조: 공통 대상 청크의 순위가 나빠지기만 한다
			const hiIdx = new Map(hi.map((h, i) => [h.chunkId, i]));
			const loIdx = new Map(lo.map((h, i) => [h.chunkId, i]));
			let compared = 0;
			for (const h of hi.filter((h) => isTarget(h.notePath))) {
				const a = hiIdx.get(h.chunkId);
				const b = loIdx.get(h.chunkId);
				if (a === undefined || b === undefined) continue;
				expect(a, `순위 역행: ${h.notePath}`).toBeLessThanOrEqual(b);
				compared++;
			}

			const fmt = (hits: HybridHit[]) =>
				hits
					.slice(0, 5)
					.map(
						(h, i) =>
							`  ${i + 1}. ${isTarget(h.notePath) ? "★" : " "} ${baseName(h.notePath)} (${h.finalScore.toFixed(5)})`,
					)
					.join("\n");
			report.push(
				`[가중치 A/B·의미] 쿼리="${q.text}" 대상 폴더="${folder}" (노트 ${snapshot.size}개, 단조비교 ${compared}청크)`,
				`  · 원래(top5):\n${fmt(base)}`,
				`  · 10점(top5):\n${fmt(hi)}`,
				`  · 1점(top5):\n${fmt(lo)}`,
				`  · 0점: 대상 폴더 결과 ${zero.filter((h) => isTarget(h.notePath)).length}건 (소멸 확인)`,
			);
		} finally {
			restoreWeights(snapshot);
		}
	});

	it("가중치 A/B — 태그 검색: finalScore = rawScore × weight, 0이면 소멸", () => {
		if (!db) throw new Error("db 미초기화");
		const q = QUERIES.find((q) => {
			const keys = keysByQuery.get(q.id);
			return (
				keys &&
				tagSearch(db!, keys, appStub, { topN: 5 }).length >= 2
			);
		});
		expect(q, "태그 결과 2개 이상인 쿼리가 없음").toBeDefined();
		if (!q) return;
		const keys = keysByQuery.get(q.id)!;
		const base = tagSearch(db, keys, appStub, { topN: 200 });
		const target = base.find((h) => h.notePath.includes("/"));
		expect(target).toBeDefined();
		if (!target) return;
		const folder = target.notePath.slice(
			0,
			target.notePath.lastIndexOf("/"),
		);
		const snapshot = snapshotFolderWeights(folder);
		const isTarget = (p: string) => p.startsWith(`${folder}/`);

		try {
			setFolderWeight(folder, 1.5);
			const hi = tagSearch(db, keys, appStub, { topN: 200 });
			for (const h of hi.filter((h) => isTarget(h.notePath))) {
				const b = base.find((x) => x.notePath === h.notePath);
				if (!b || b.noteWeight === 0) continue;
				// rawScore = finalScore / weight 가 가중치 변경 전후 동일해야 한다
				expect(
					relClose(
						h.finalScore / h.noteWeight,
						b.finalScore / b.noteWeight,
					),
					`rawScore 변동: ${h.notePath}`,
				).toBe(true);
				expect(relClose(h.noteWeight, 1.5)).toBe(true);
			}
			setFolderWeight(folder, 0);
			const zero = tagSearch(db, keys, appStub, { topN: 200 });
			expect(zero.some((h) => isTarget(h.notePath))).toBe(false);
			report.push(
				`[가중치 A/B·태그] 쿼리="${q.text}" 대상 폴더="${folder}" — rawScore 보존·0점 소멸 확인 (기준 ${base.length}건)`,
			);
		} finally {
			restoreWeights(snapshot);
		}
	});

	it("태그 키 추출 — 교리 정확 매칭이 잡힌다", () => {
		const keys = keysByQuery.get("doctrine-exact")!;
		const fmt = (s: Set<string>) => [...s].join(",") || "∅";
		report.push(
			`[키 추출] "칭의란 무엇인가" → dExact={${fmt(keys.dExact)}} dSyn={${fmt(keys.dSyn)}} tExact={${fmt(keys.tExact)}}`,
		);
		if (lexicons?.doctrine.has("칭의")) {
			expect(keys.dExact.has("칭의")).toBe(true);
		}
		const synKeys = keysByQuery.get("doctrine-syn")!;
		report.push(
			`[키 추출] "의롭다 하심을 얻는 은혜" → dExact={${fmt(synKeys.dExact)}} dSyn={${fmt(synKeys.dSyn)}}${synonymIndex.size === 0 ? " (동의어 인덱스 없음 — A4P_LIVE_DATA 미지정)" : ""}`,
		);
	});

	it.skipIf(!API_KEY && !fs.existsSync(`${LIVE_DB}.query-cache.json`))(
		"벡터 키 발견 회귀 — '거룩해지는 삶' → doctrine에서 성화 발견 (0.1.0 실측 기준)",
		() => {
			if (!db || !lexicons) throw new Error("초기화 실패");
			const vec = embByQuery.get("vec-discovery");
			expect(vec, "쿼리 임베딩 없음").toBeDefined();
			if (!vec) return;
			const keys = keysByQuery.get("vec-discovery")!;
			const dEmb = loadAllKeyEmbeddings(
				db,
				"doctrine_embeddings",
				EMBEDDING_MODEL,
			);
			const tEmb = loadAllKeyEmbeddings(
				db,
				"tag_embeddings",
				EMBEDDING_MODEL,
			);
			expect(dEmb.size).toBeGreaterThan(0);
			const exclude = new Set([...keys.dExact, ...keys.dSyn]);
			const dVec = topVectorKeys(
				vec,
				dEmb,
				lexicons.doctrine,
				exclude,
				VEC_THRESHOLD_DOCTRINE,
				VEC_TOPK,
			);
			const tVec = topVectorKeys(
				vec,
				tEmb,
				lexicons.tag,
				new Set([...keys.tExact]),
				VEC_THRESHOLD_TAG,
				VEC_TOPK,
			);
			report.push(
				`[벡터 발견] "거룩해지는 삶" → dVec=[${dVec.join(",")}] tVec=[${tVec.join(",")}] (키 임베딩 d=${dEmb.size}/t=${tEmb.size})`,
			);
			expect(dVec, "회귀: dVec에 성화가 없음").toContain("성화");
		},
	);

	it("정합성 리포트 — 8쿼리 출력·메트릭 (관찰용)", () => {
		if (!db) throw new Error("db 미초기화");
		let snippetMiss = 0;
		let snippetTotal = 0;
		let tagMiss = 0;
		let tagTotal = 0;
		for (const q of QUERIES) {
			const t0 = performance.now();
			const hy = runHybrid(q.id, 10);
			const hyMs = performance.now() - t0;
			const keys = keysByQuery.get(q.id)!;
			const t1 = performance.now();
			const tg = tagSearch(db, keys, appStub, { topN: 10 });
			const tgMs = performance.now() - t1;
			expect(hy.length).toBeLessThanOrEqual(10);
			expect(tg.length).toBeLessThanOrEqual(10);

			const terms = tokensByQuery.get(q.id) ?? [];
			for (const h of hy.slice(0, 5)) {
				snippetTotal++;
				const hit = terms.some(
					(t) => t.length >= 2 && h.preview.toLowerCase().includes(t),
				);
				if (!hit) snippetMiss++;
			}
			const allKeys = [
				...keys.dExact,
				...keys.dSyn,
				...keys.dVec,
				...keys.tExact,
				...keys.tVec,
			];
			for (const h of tg.slice(0, 5)) {
				tagTotal++;
				if (!allKeys.some((k) => h.preview.includes(k))) tagMiss++;
			}

			const flag = (h: HybridHit) =>
				`${h.bm25Rank ? `B${h.bm25Rank}` : ""}${h.vectorRank ? `V${h.vectorRank}` : ""}${h.headingMatched ? "H" : ""} ${h.matchedQueryTerms}/${h.queryTermsTotal}`;
			report.push(
				`[쿼리:${q.id}] "${q.text}" terms=[${terms.join(",")}] → 의미 ${hy.length}건(${hyMs.toFixed(0)}ms)/태그 ${tg.length}건(${tgMs.toFixed(0)}ms)`,
				...hy
					.slice(0, 3)
					.map(
						(h, i) =>
							`    의미${i + 1}. ${baseName(h.notePath)} [${flag(h)}] ${h.finalScore.toFixed(5)}`,
					),
				...tg
					.slice(0, 3)
					.map(
						(h, i) =>
							`    태그${i + 1}. ${baseName(h.notePath)} (${h.matchedQueryTerms}키) ${h.finalScore.toFixed(2)}`,
					),
			);
		}
		report.push(
			`[메트릭] 의미 top5 스니펫에 검색어 미노출: ${snippetMiss}/${snippetTotal} | 태그 top5 미리보기에 매칭 키 미노출: ${tagMiss}/${tagTotal} (7단계 개선 전 기준값)`,
		);
	});
});
