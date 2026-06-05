import { Notice, Plugin } from "obsidian";
import type { Database } from "sql.js";
import {
	DEFAULT_SETTINGS,
	WeightedRecallSettings,
	isValidSettings,
	migrateLegacySettings,
	migrateToFlat,
	normalizeSettings,
} from "./settings";
import { WeightedRecallSettingTab } from "./settings-tab";
import { loadOrCreateDb, saveDb } from "./db/persistence";
import { runFullIndex } from "./indexer/indexer";
import { reapplyFolderSettings } from "./indexer/scanner";
import { embedMissingChunks } from "./embedder/embed-all";
import { embedTexts } from "./embedder/openai";
import { bm25Search } from "./search/bm25";
import { hybridSearch } from "./search/hybrid";
import { RecallView, RECALL_VIEW_TYPE } from "./views/RecallView";
import { WR_STYLES } from "./views/styles";
import {
	tokenize,
	tokenizeKorean,
	preloadMorpheme,
	destroyMorpheme,
	benchMorpheme,
} from "./morpheme";

declare const __DEV__: boolean;

function countChunks(db: Database): number {
	const row = db.exec("SELECT COUNT(*) FROM chunks")[0];
	return row ? Number(row.values[0][0]) : 0;
}

export default class WeightedRecallPlugin extends Plugin {
	settings: WeightedRecallSettings = DEFAULT_SETTINGS;
	db: Database | null = null;
	private styleEl: HTMLStyleElement | null = null;
	private busy = false;
	private migratedThisLoad = false;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new WeightedRecallSettingTab(this.app, this));

		this.styleEl = document.createElement("style");
		this.styleEl.id = "weighted-recall-styles";
		this.styleEl.textContent = WR_STYLES;
		document.head.appendChild(this.styleEl);

		this.registerView(
			RECALL_VIEW_TYPE,
			(leaf) => new RecallView(leaf, this),
		);

		this.registerHoverLinkSource(RECALL_VIEW_TYPE, {
			display: "A4P Sermon Desk",
			defaultMod: true,
		});

		this.addCommand({
			id: "open-recall-pane",
			name: "설교 준비 데스크 열기",
			callback: async () => {
				const { workspace } = this.app;
				let leaf = workspace.getLeavesOfType(RECALL_VIEW_TYPE)[0];
				if (!leaf) {
					const right = workspace.getRightLeaf(false);
					if (right) {
						leaf = right;
						await leaf.setViewState({
							type: RECALL_VIEW_TYPE,
							active: true,
						});
					}
				}
				if (leaf) workspace.revealLeaf(leaf);
			},
		});

		this.db = await loadOrCreateDb(this);
		const v = this.db.exec("SELECT value FROM meta WHERE key='schema_version'");
		const version = v[0]?.values[0]?.[0] ?? "?";
		console.log(`[a4p-sermon-desk] db loaded, schema=${version}`);

		// 설정 마이그레이션이 일어났다면, 기존 인덱스의 그룹/가중치를 비파괴적으로 재적용
		if (this.migratedThisLoad) {
			try {
				const r = reapplyFolderSettings(this.db, this.settings);
				await this.persistDb();
				console.log(
					`[a4p-sermon-desk] 마이그레이션 후 폴더 재적용: ${r.updated} notes`,
				);
			} catch (e) {
				console.error(
					"[a4p-sermon-desk] post-migration reapply failed",
					e,
				);
			}
		}

		// ── DEV 전용 디버그 커맨드 (production 빌드에서 자동 제거) ──
		if (__DEV__) {

		this.addCommand({
			id: "hybrid-search-debug",
			name: "Hybrid search top-K (debug)",
			callback: async () => {
				if (!this.db) {
					new Notice("A4P Sermon Desk: DB가 로드되지 않았습니다");
					return;
				}
				if (countChunks(this.db) === 0) {
					new Notice(
						"A4P Sermon Desk: 아직 인덱싱된 노트가 없습니다. 먼저 'Reindex all notes'를 실행해주세요.",
					);
					return;
				}
				const queries = [
					"회개",
					"예수님 십자가",
					"은혜와 믿음",
				];
				const apiKey = this.settings.openaiApiKey;
				new Notice(
					"A4P Sermon Desk: Hybrid 검색 — 콘솔 확인",
				);
				if (!apiKey) {
					new Notice(
						"A4P Sermon Desk: API 키 없음 — BM25만 사용합니다",
					);
				}
				try {
					await preloadMorpheme();
					for (const q of queries) {
						const queryTerms = await tokenize(q);
						let queryEmbedding: Float32Array | null = null;
						if (apiKey) {
							try {
								const vecs = await embedTexts([q], apiKey);
								queryEmbedding = vecs[0] ?? null;
							} catch (e) {
								console.warn(
									`[a4p-sermon-desk][hybrid] embedding failed for "${q}":`,
									e,
								);
							}
						}
						console.log(
							`[a4p-sermon-desk][hybrid] === query="${q}" terms=[${queryTerms.join(",")}] vector=${queryEmbedding ? "yes" : "no"} ===`,
						);
						const stages = [
							{
								label: "RRF only",
								opts: {
									applyWeight: false,
									applyHeadingBoost: false,
								},
							},
							{
								label: "+weight",
								opts: {
									applyWeight: true,
									applyHeadingBoost: false,
								},
							},
							{
								label: "+heading",
								opts: {
									applyWeight: true,
									applyHeadingBoost: true,
								},
							},
						];
						for (const stage of stages) {
							const t0 = performance.now();
							const hits = hybridSearch(
								this.db,
								queryTerms,
								queryEmbedding,
								{ ...stage.opts, topN: 5 },
							);
							const ms = performance.now() - t0;
							console.log(
								`[a4p-sermon-desk][hybrid] [${stage.label}] ${hits.length} hits in ${ms.toFixed(1)}ms`,
							);
							for (const h of hits) {
								const flags = `${h.headingMatched ? "H" : "-"}${h.bm25Rank !== null ? "B" : "-"}${h.vectorRank !== null ? "V" : "-"}`;
								console.log(
									`[a4p-sermon-desk][hybrid-hit] ${h.finalScore.toFixed(4)} [${flags}] w=${h.noteWeight.toFixed(2)} bm25=${h.bm25Rank ?? "-"} vec=${h.vectorRank ?? "-"} ${h.notePath} #${h.heading ?? "-"} :: ${h.preview}`,
								);
							}
						}
					}
				} catch (e) {
					new Notice(
						`A4P Sermon Desk: Hybrid 실패 — ${(e as Error).message}`,
					);
					console.error("[a4p-sermon-desk] hybrid failed", e);
				}
			},
		});

		this.addCommand({
			id: "bm25-search-debug",
			name: "BM25 search top-K (debug)",
			callback: async () => {
				if (!this.db) {
					new Notice("A4P Sermon Desk: DB가 로드되지 않았습니다");
					return;
				}
				if (countChunks(this.db) === 0) {
					new Notice(
						"A4P Sermon Desk: 아직 인덱싱된 노트가 없습니다. 먼저 'Reindex all notes'를 실행해주세요.",
					);
					return;
				}
				const queries = [
					"회개",
					"예수님 십자가",
					"은혜와 믿음",
				];
				new Notice("A4P Sermon Desk: BM25 검색 — 콘솔 확인");
				try {
					await preloadMorpheme();
					for (const q of queries) {
						const queryTerms = await tokenize(q);
						console.log(
							`[a4p-sermon-desk][bm25] query="${q}" → terms=[${queryTerms.join(",")}]`,
						);
						const t0 = performance.now();
						const hits = bm25Search(this.db, queryTerms, 5);
						const ms = performance.now() - t0;
						console.log(
							`[a4p-sermon-desk][bm25] ${hits.length} hits in ${ms.toFixed(1)}ms`,
						);
						if (hits.length === 0) continue;
						const ids = hits.map((h) => h.chunkId);
						const placeholders = ids.map(() => "?").join(",");
						const rows = this.db.exec(
							`SELECT id, note_path, heading, SUBSTR(text, 1, 80) FROM chunks WHERE id IN (${placeholders})`,
							ids,
						);
						const meta = new Map<number, { path: string; heading: string | null; preview: string }>();
						if (rows[0]) {
							for (const r of rows[0].values) {
								meta.set(Number(r[0]), {
									path: String(r[1]),
									heading: r[2] === null ? null : String(r[2]),
									preview: String(r[3]),
								});
							}
						}
						for (const h of hits) {
							const m = meta.get(h.chunkId);
							console.log(
								`[a4p-sermon-desk][bm25-hit] ${h.score.toFixed(3)} ${m?.path ?? "?"} #${m?.heading ?? "-"} :: ${m?.preview ?? "?"}`,
							);
						}
					}
				} catch (e) {
					new Notice(
						`A4P Sermon Desk: BM25 실패 — ${(e as Error).message}`,
					);
					console.error("[a4p-sermon-desk] bm25 failed", e);
				}
			},
		});

		this.addCommand({
			id: "morpheme-bench",
			name: "Morpheme bench: analyze vs tokenize (debug)",
			callback: async () => {
				const samples = [
					{
						name: "short (~30c)",
						text: "회개하는 죄인은 의롭게 된다.",
					},
					{
						name: "medium (~200c)",
						text: "예수님께서 우리 죄를 대신하여 십자가에서 죽으셨다는 사실은 기독교 신앙의 핵심이다. 그분의 부활은 죽음을 이기신 승리의 증거이며, 모든 믿는 자에게 영생의 소망을 준다. 이 복음의 진리를 우리는 매일 묵상하며 살아가야 한다.",
					},
					{
						name: "long (~1500c)",
						text: "예수님께서 우리 죄를 대신하여 십자가에서 죽으셨다는 사실은 기독교 신앙의 핵심이다. 그분의 부활은 죽음을 이기신 승리의 증거이며, 모든 믿는 자에게 영생의 소망을 준다. 이 복음의 진리를 우리는 매일 묵상하며 살아가야 한다. ".repeat(
							12,
						),
					},
				];
				new Notice(
					"A4P Sermon Desk: 형태소 벤치 — 콘솔 확인 (시간 걸림)",
				);
				try {
					await preloadMorpheme();
					for (const s of samples) {
						const r = await benchMorpheme(s.text, 50);
						console.log(
							`[a4p-sermon-desk][bench] ${s.name} (${s.text.length} chars): analyze ${r.analyzeMs.toFixed(2)}ms, tokenize ${r.tokenizeMs.toFixed(2)}ms (ratio ${(r.analyzeMs / r.tokenizeMs).toFixed(2)}x)`,
						);
					}
				} catch (e) {
					new Notice(
						`A4P Sermon Desk: 벤치 실패 — ${(e as Error).message}`,
					);
					console.error("[a4p-sermon-desk] bench failed", e);
				}
			},
		});

		this.addCommand({
			id: "morpheme-smoke",
			name: "Test morpheme tokenizer (debug)",
			callback: async () => {
				const samples = [
					"회개하는 죄인은 의롭게 된다",
					"OpenAI의 GPT-4 모델을 사용했다",
					"BM25 검색 결과 score 0.85",
					"",
				];
				new Notice("A4P Sermon Desk: 형태소 분석 — 콘솔 확인");
				try {
					for (const text of samples) {
						const ko = await tokenizeKorean(text);
						const mixed = await tokenize(text);
						console.log(
							`[a4p-sermon-desk][morpheme] "${text}"`,
							{ tokenizeKorean: ko, tokenize: mixed },
						);
					}
				} catch (e) {
					new Notice(
						`A4P Sermon Desk: 형태소 실패 — ${(e as Error).message}`,
					);
					console.error("[a4p-sermon-desk] morpheme failed", e);
				}
			},
		});

		} // end DEV-only debug commands

		console.log("[a4p-sermon-desk] loaded BUILD=v11-a4p-rename");
	}

	private async withBusy(fn: () => Promise<void>): Promise<void> {
		if (this.busy) {
			new Notice(
				"A4P Sermon Desk: 다른 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.",
			);
			return;
		}
		this.busy = true;
		try {
			await fn();
		} finally {
			this.busy = false;
		}
	}

	private async runEmbedding(notifyMissingKey: boolean): Promise<void> {
		if (!this.db) {
			new Notice("A4P Sermon Desk: DB가 로드되지 않았습니다");
			return;
		}
		const apiKey = this.settings.openaiApiKey;
		if (!apiKey) {
			if (notifyMissingKey) {
				new Notice(
					"OpenAI API 키가 설정되지 않았습니다. 설정 → A4P Sermon Desk에서 입력해주세요.",
				);
			}
			return;
		}
		const progress = new Notice("A4P Sermon Desk: 임베딩 중…", 0);
		try {
			const r = await embedMissingChunks(
				this.db,
				apiKey,
				(p) =>
					progress.setMessage(
						`A4P Sermon Desk: 임베딩 ${p.done}/${p.total}`,
					),
			);
			await saveDb(this, this.db);
			progress.hide();
			if (r.embedded === 0) {
				new Notice("A4P Sermon Desk: 임베딩할 청크가 없습니다");
			} else {
				new Notice(
					`A4P Sermon Desk: 임베딩 ${r.embedded}개 완료`,
				);
			}
			console.log(
				`[a4p-sermon-desk] embed done: ${r.embedded} chunks`,
			);
		} catch (e) {
			progress.hide();
			new Notice(
				`A4P Sermon Desk: 임베딩 실패 — ${(e as Error).message}`,
			);
			console.error("[a4p-sermon-desk] embed failed", e);
		}
	}

	async onunload() {
		if (this.db) {
			try {
				await saveDb(this, this.db);
			} catch (e) {
				console.error("[a4p-sermon-desk] save on unload failed", e);
			}
			this.db.close();
			this.db = null;
		}
		destroyMorpheme();
		if (this.styleEl) {
			this.styleEl.remove();
			this.styleEl = null;
		}
		console.log("[a4p-sermon-desk] unloaded");
	}

	async loadSettings() {
		const data = await this.loadData();
		const flat = migrateToFlat(data);
		if (flat) {
			this.settings = normalizeSettings(flat);
			this.migratedThisLoad = true;
			await this.saveSettings();
			console.log(
				"[a4p-sermon-desk] 카테고리 → 평면 폴더 모델로 마이그레이션됨",
			);
			return;
		}
		if (isValidSettings(data)) {
			const merged = Object.assign(
				{},
				DEFAULT_SETTINGS,
				data,
			) as WeightedRecallSettings;
			this.settings = normalizeSettings(merged);
			return;
		}
		const legacy = migrateLegacySettings(data);
		if (legacy) {
			this.settings = normalizeSettings(legacy);
			this.migratedThisLoad = true;
			await this.saveSettings();
			console.log(
				"[a4p-sermon-desk] 초레거시 folderWeights 마이그레이션됨",
			);
			return;
		}
		if (data) {
			console.log(
				"[a4p-sermon-desk] 알 수 없는 설정 형식, 기본값으로 초기화",
			);
		}
		this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		await this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** 전체 재색인 — 커맨드와 설정 탭 버튼이 공유. */
	async runReindex(): Promise<void> {
		return this.withBusy(async () => {
			if (!this.db) {
				new Notice("A4P Sermon Desk: DB가 로드되지 않았습니다");
				return;
			}
			const progress = new Notice(
				"A4P Sermon Desk: 형태소 모델 로드 중…",
				0,
			);
			try {
				await preloadMorpheme();
				progress.setMessage("A4P Sermon Desk: 인덱싱 0/?");
				const result = await runFullIndex(
					this.app,
					this.db,
					this.settings,
					{
						onProgress: (done, total) =>
							progress.setMessage(
								`A4P Sermon Desk: 인덱싱 ${done}/${total}`,
							),
					},
				);
				await saveDb(this, this.db);
				progress.hide();
				new Notice(
					`A4P Sermon Desk: ${result.notes} 노트, ${result.chunks} 청크 인덱싱 완료`,
				);
			} catch (e) {
				progress.hide();
				new Notice(
					`A4P Sermon Desk: 인덱싱 실패 — ${(e as Error).message}`,
				);
				console.error("[a4p-sermon-desk] reindex failed", e);
				return;
			}
			await this.runEmbedding(false);
		});
	}

	/** 경량 재적용 — 재색인 없이 기존 인덱스의 그룹/가중치만 갱신. */
	async runReapply(): Promise<void> {
		return this.withBusy(async () => {
			if (!this.db) {
				new Notice("A4P Sermon Desk: DB가 로드되지 않았습니다");
				return;
			}
			try {
				const r = reapplyFolderSettings(this.db, this.settings);
				await this.persistDb();
				new Notice(
					`A4P Sermon Desk: 폴더 설정 재적용 — ${r.updated}개 노트`,
				);
			} catch (e) {
				new Notice(
					`A4P Sermon Desk: 재적용 실패 — ${(e as Error).message}`,
				);
				console.error("[a4p-sermon-desk] reapply failed", e);
			}
		});
	}

	async persistDb() {
		if (this.db) await saveDb(this, this.db);
	}
}
