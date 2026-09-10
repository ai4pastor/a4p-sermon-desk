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
import {
	hybridSearch,
	VECTOR_NOISE_THRESHOLD,
	cosineMeter,
	type HybridHit,
} from "../src/search/hybrid";
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
import { topVectorKeys, vectorSearch } from "../src/search/vector";
import { lexScope, loadAllKeyEmbeddings, TAG_SCOPE } from "../src/db/embeddings";
import { runMigrations } from "../src/db/migrate";
import { EMBEDDING_MODEL, embedTexts } from "../src/embedder/openai";
import { setProtectedForTests, tokenizeReal } from "./helpers/garu-node";
import { deriveProtectedTerms } from "../src/morpheme/protected";

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
/** data.json의 렉시콘 id(v4) — 없으면 v3 백필과 같은 "doctrine". */
let liveLexiconIds: string[] = ["doctrine"];
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
	const cov = h.queryTermsTotal >= 2 ? 1 + coverage * 0.5 : 1;
	const cosM = h.vectorScore === null ? 0 : cosineMeter(h.vectorScore);
	return (
		h.rrfScore * w * (h.headingMatched ? 1.2 : 1) * cov * (1 + cosM * 0.5)
	);
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
		// 사본이 구 스키마(v2)면 메모리 안에서 v3로 올린다 — 실 데이터 마이그레이션 검증 겸함.
		const migrated = runMigrations(db);
		report.push(`[스키마] 마이그레이션 ${migrated ? "실행됨(v2→v3)" : "불필요(최신)"}`);
		const embRows = db.exec("SELECT scope, COUNT(*) FROM key_embeddings GROUP BY scope ORDER BY scope")[0]?.values ?? [];
		const lexRows = db.exec("SELECT lexicon_id, COUNT(*), COUNT(DISTINCT key) FROM note_lexicon_keys GROUP BY lexicon_id")[0]?.values ?? [];
		report.push(
			`[렉시콘] 키 임베딩 ${embRows.map((r) => `${r[0]}=${r[1]}`).join(" · ") || "없음"} / 노트 매핑 ${lexRows.map((r) => `${r[0]}: ${r[1]}행·${r[2]}키`).join(" · ") || "없음"}`,
		);
		let protectedCount = 0;
		if (DATA_JSON) {
			// 렉시콘(v4) 또는 doctrine*(v3 이하)·보호 단어 필드만 사용. 다른 내용(API 키 등)은 읽지도 출력하지도 않는다.
			const raw = JSON.parse(fs.readFileSync(DATA_JSON, "utf8")) as {
				lexicons?: {
					id: string;
					keywords?: string[];
					synonyms?: Record<string, string[]>;
				}[];
				doctrineSynonyms?: Record<string, string[]>;
				doctrineKeywords?: string[];
				protectedTerms?: string[];
			};
			const lexes =
				Array.isArray(raw.lexicons) && raw.lexicons.length > 0
					? raw.lexicons.map((l) => ({
							id: l.id,
							keywords: l.keywords ?? [],
							synonyms: l.synonyms ?? {},
						}))
					: [
							{
								id: "doctrine",
								keywords: raw.doctrineKeywords ?? [],
								synonyms: raw.doctrineSynonyms ?? {},
							},
						];
			liveLexiconIds = lexes.map((l) => l.id);
			synonymIndex = new Map();
			for (const l of lexes) {
				for (const [k, lists] of await buildSynonymTokenIndex(l.synonyms)) {
					const prev = synonymIndex.get(k);
					synonymIndex.set(k, prev ? [...prev, ...lists] : lists);
				}
			}
			// 0.8.0 보호 단어 — 실제 앱과 같은 도출 규칙으로 쿼리 토큰에 적용.
			const prot = deriveProtectedTerms({
				lexicons: lexes,
				protectedTerms: raw.protectedTerms ?? [],
			});
			setProtectedForTests(prot);
			protectedCount = prot.length;
		}
		lexicons = loadSearchLexicons(db, liveLexiconIds);

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
			`[env] notes=${counts[0]} chunks=${counts[1]} embeddings=${counts[2]} | 임베딩 사용: ${embByQuery.size}/${QUERIES.length}쿼리 | 동의어 인덱스: ${synonymIndex.size}키 | 보호 단어: ${protectedCount}개`,
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
				// 🔬 분석 trace — 실데이터에서도 RRF 분해 합이 rrfScore와 일치
				expect(h.trace, `${q.id} ${h.notePath} trace 누락`).toBeDefined();
				expect(
					relClose(h.trace!.rrfBm25 + h.trace!.rrfVector, h.rrfScore),
					`${q.id} ${h.notePath} rrf 분해 불일치`,
				).toBe(true);
				expect(h.trace!.matchedTerms.length).toBe(h.matchedQueryTerms);
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

	it("후보 게이트 A/B (0.11.0) — 활성 프로파일 0점 폴더가 후보 K를 소모하지 않는다", () => {
		if (!db) throw new Error("db 미초기화");
		// 시나리오: 쿼리별로 기준 결과(해석기 없음)를 가장 많이 차지한 폴더를 활성
		// 프로파일에서 0점으로 둔다 — 연구 테마가 180. 설교조각을 0으로 두는 상황의
		// 재현. 나머지 노트는 DB weight 그대로.
		const dbWeight = new Map<string, number>();
		for (const r of db.exec("SELECT path, weight FROM notes")[0]?.values ?? []) {
			dbWeight.set(String(r[0]), Number(r[1]));
		}
		const folderOf = (p: string) => p.slice(0, p.lastIndexOf("/"));

		const lines: string[] = [];
		let improved = 0;
		let compared = 0;
		for (const q of QUERIES) {
			const tokens = tokensByQuery.get(q.id) ?? [];
			const emb = embByQuery.get(q.id) ?? null;
			const baseline = hybridSearch(db, tokens, emb, { topN: 50 });
			if (baseline.length === 0) {
				lines.push(`  · ${q.id}: 기준 결과 0 (비교 생략)`);
				continue;
			}
			const byFolder = new Map<string, number>();
			for (const h of baseline) {
				const f = folderOf(h.notePath);
				byFolder.set(f, (byFolder.get(f) ?? 0) + 1);
			}
			const folder = [...byFolder.entries()].sort((a, b) => b[1] - a[1])[0][0];
			const isTarget = (p: string) => p.startsWith(`${folder}/`);
			const resolver = (p: string) =>
				isTarget(p) ? 0 : (dbWeight.get(p) ?? 0);
			// 예전 동작 재현: 후보는 전 노트에서 뽑고 결과에서 0점만 제거.
			const before = baseline.filter((h) => !isTarget(h.notePath));
			// 새 동작: 후보 단계에서 0점 노트를 걸러 유효 후보로 K를 채운다.
			const after = hybridSearch(db, tokens, emb, {
				topN: 50,
				resolveWeight: resolver,
			});
			expect(after.some((h) => isTarget(h.notePath))).toBe(false);
			expect(
				after.length,
				`${q.id}: 게이트 후 결과가 줄었다`,
			).toBeGreaterThanOrEqual(before.length);
			// 살아남은 청크의 점수 구성은 동일 규칙(RRF 순위만 유효 후보 안에서 재배치).
			for (const h of after) {
				expect(
					relClose(h.finalScore, expectedFinal(h, h.noteWeight)),
					`${q.id} ${h.notePath} 게이트 후 공식 불일치`,
				).toBe(true);
			}
			compared++;
			if (after.length > before.length) improved++;
			const removed = baseline.length - before.length;
			lines.push(
				`  · ${q.id}: 0점="${baseName(folder)}"(기준 ${baseline.length} 중 ${removed}) → 유효 결과 ${before.length} → ${after.length}${after.length > before.length ? " ▲" : ""}`,
			);
		}
		report.push(
			`[후보 게이트 A/B] 쿼리별 지배 폴더를 0점으로 — 개선 쿼리 ${improved}/${compared}`,
			...lines,
		);
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
		if (lexicons?.lexicon.has("칭의")) {
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
			const dEmb = new Map<string, Float32Array>();
			for (const id of liveLexiconIds) {
				for (const [k, v] of loadAllKeyEmbeddings(db, lexScope(id), EMBEDDING_MODEL)) {
					dEmb.set(k, v);
				}
			}
			const tEmb = loadAllKeyEmbeddings(
				db,
				TAG_SCOPE,
				EMBEDDING_MODEL,
			);
			expect(dEmb.size).toBeGreaterThan(0);
			const exclude = new Set([...keys.dExact, ...keys.dSyn]);
			const dVec = topVectorKeys(
				vec,
				dEmb,
				lexicons.lexicon,
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
		let fullMiss = 0;
		let tagMiss = 0;
		let tagTotal = 0;
		const abTotal = { off: 0, on: 0 };
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
				// 개선 후(makeSnippet)는 fullText에 매칭이 있으면 반드시 보여주므로
				// fullText 미스율이 곧 개선 후 스니펫 미스율이다.
				const fullHit = terms.some(
					(t) =>
						t.length >= 2 && h.fullText.toLowerCase().includes(t),
				);
				if (!fullHit) fullMiss++;
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
			// 벡터 후보 유사도 분포 — 잡음 문턱(0.6)을 넘는 후보가 실제로 있는지
			const emb = embByQuery.get(q.id);
			const vh = emb ? vectorSearch(db, emb, EMBEDDING_MODEL, 30) : [];
			const sims = vh.map((v) => v.similarity).sort((a, b) => b - a);
			const over = (t: number) => sims.filter((x) => x >= t).length;
			const vecLine =
				sims.length === 0
					? "벡터 후보 없음"
					: `벡터 후보 30: 최고 ${sims[0].toFixed(3)} · 중위 ${sims[Math.floor(sims.length / 2)].toFixed(3)} · 최저 ${sims[sims.length - 1].toFixed(3)} · ≥0.40:${over(0.4)} ≥0.43:${over(0.43)} ≥0.45:${over(0.45)} ≥0.48:${over(0.48)} ≥0.50:${over(0.5)} ≥${VECTOR_NOISE_THRESHOLD}:${over(VECTOR_NOISE_THRESHOLD)}`;
			// 코사인 보너스 A/B — 의미 전용 히트가 top10에 올라오는지(0.8.0 §3 조치 효과)
			const hyOff = hybridSearch(
				db,
				tokensByQuery.get(q.id) ?? [],
				embByQuery.get(q.id) ?? null,
				{ topN: 10, applyCosineBoost: false },
			);
			const semOnlyOff = hyOff.filter((h) => !h.bm25Rank).length;
			const semOnlyOn = hy.filter((h) => !h.bm25Rank).length;
			abTotal.off += semOnlyOff;
			abTotal.on += semOnlyOn;
			// 🔬 분석 진단: top10의 소스(어휘만/의미만/양쪽)·잡음 필터 통과 사유 분포
			const src = { b: 0, v: 0, bv: 0 };
			const pass = { terms: 0, vector: 0, both: 0, none: 0 };
			for (const h of hy) {
				if (h.bm25Rank && h.vectorRank) src.bv++;
				else if (h.bm25Rank) src.b++;
				else src.v++;
				pass[h.trace?.passedBy ?? "none"]++;
			}
			report.push(
				`[쿼리:${q.id}] "${q.text}" terms=[${terms.join(",")}] → 의미 ${hy.length}건(${hyMs.toFixed(0)}ms)/태그 ${tg.length}건(${tgMs.toFixed(0)}ms)`,
				`    소스: 어휘만 ${src.b} · 의미만 ${src.v} · 양쪽 ${src.bv} | 통과: 검색어 ${pass.terms} · 의미 ${pass.vector} · 둘다 ${pass.both}`,
				`    ${vecLine}`,
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
		// 조치 후 의미 전용 히트가 줄어들지는 않아야 한다(soft 회귀 가드).
		expect(abTotal.on).toBeGreaterThanOrEqual(abTotal.off);
		report.push(
			`[의미 전용 A/B] 코사인 보너스 off=${abTotal.off}/${QUERIES.length * 10} → on=${abTotal.on}/${QUERIES.length * 10} (top10 합산)`,
		);
		report.push(
			`[메트릭] 의미 top5 스니펫 검색어 미노출: 고정 앞부분 ${snippetMiss}/${snippetTotal} → 매칭 부근 스니펫 적용 시 ${fullMiss}/${snippetTotal} | 태그 top5 미리보기 매칭 키 미노출: ${tagMiss}/${tagTotal} (칩이 근거 표시로 보완)`,
		);
	});
});
