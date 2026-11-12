import {
	type Editor,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
} from "obsidian";
import { paragraphAround } from "./paragraph";
import type { Database } from "sql.js";
import {
	DEFAULT_SETTINGS,
	WeightedRecallSettings,
	isValidSettings,
	migrateLegacySettings,
	migrateToFlat,
	mirrorActiveWeights,
	normalizeSettings,
} from "./settings";
import { WeightedRecallSettingTab } from "./settings-tab";
import { createIdeaMemo } from "./idea-memo-create";
import {
	compactDb,
	loadOrCreateDb,
	openDbFile,
	saveDb,
	type CompactResult,
} from "./db/persistence";
import { retokenizeAllChunks, runIndex } from "./indexer/indexer";
import {
	deleteNoteRows,
	deleteNotesUnderFolder,
	listNotesUnderFolder,
	renameNoteRows,
} from "./indexer/note-rows";
import {
	deriveProtectedTerms,
	protectedFingerprint,
} from "./morpheme/protected";
import {
	categorizeFile,
	reapplyFolderSettings,
	scanVault,
} from "./indexer/scanner";
import { embedMissingChunks } from "./embedder/embed-all";
import { embedTexts } from "./embedder/openai";
import { bm25Search, resetBm25Cache } from "./search/bm25";
import { resetVectorCache } from "./search/vector";
import { hybridSearch } from "./search/hybrid";
import {
	RecallView,
	RECALL_VIEW_TYPE,
	MIN_PARAGRAPH_CHARS,
	MIN_SELECTION_CHARS,
} from "./views/RecallView";
import { WR_STYLES } from "./views/styles";
import {
	tokenize,
	tokenizeKorean,
	preloadMorpheme,
	destroyMorpheme,
	benchMorpheme,
	setProtectedTerms,
} from "./morpheme";

declare const __DEV__: boolean;

/** 에디터에서 검색 쿼리 결정 — 직접 선택(2자+) 우선, 없으면 커서 문단(10자+). */
function queryFromEditor(
	editor: Editor,
): { text: string; mode: "selection" | "paragraph" } | null {
	const sel = editor.getSelection().trim();
	if (sel.length >= MIN_SELECTION_CHARS) return { text: sel, mode: "selection" };
	const para = paragraphAround(
		editor.getValue().split("\n"),
		editor.getCursor().line,
	);
	if (para.length >= MIN_PARAGRAPH_CHARS) return { text: para, mode: "paragraph" };
	return null;
}

function countChunks(db: Database): number {
	const row = db.exec("SELECT COUNT(*) FROM chunks")[0];
	return row ? Number(row.values[0][0]) : 0;
}

/** 볼트 삭제·이름 변경 이벤트 — 색인 행에 즉시 반영할 최소 정보. */
type VaultOp =
	| { kind: "delete"; path: string; isFolder: boolean }
	| { kind: "rename"; oldPath: string; newPath: string; isFolder: boolean };

/** 삭제·이름 변경 후 index.db(설치본 100MB급) 저장을 묶는 지연 시간. */
const VAULT_SAVE_DELAY_MS = 30_000;

/** 압축 뒤 옛 DB를 닫기까지의 유예 — 임베딩 API 대기(30초 × 재시도)를 넉넉히 덮는다. */
const RETIRED_DB_CLOSE_MS = 120_000;

export default class WeightedRecallPlugin extends Plugin {
	settings: WeightedRecallSettings = DEFAULT_SETTINGS;
	db: Database | null = null;
	private styleEl: HTMLStyleElement | null = null;
	private busy = false;
	private migratedThisLoad = false;
	/** 마지막 저장 이후 DB 변경 여부 — unload 시 불필요한 재저장을 막는다 */
	private dbDirty = false;
	/** busy(재색인 등) 중 들어온 볼트 삭제·이름 변경 — 작업이 끝난 뒤 순서대로 반영 */
	private pendingVaultOps: VaultOp[] = [];
	/** 지연 저장 타이머 — 삭제·이름 변경마다 index.db를 다시 쓰지 않도록 묶는다 */
	private saveTimer: number | null = null;
	/** index.db 불러오기 상태 — onload를 막지 않도록 레이아웃 준비 뒤(또는 첫 사용 때) 읽는다 */
	dbStatus: "loading" | "ready" | "failed" = "loading";
	private dbLoad: Promise<void> | null = null;
	private unloaded = false;
	private settingTab: WeightedRecallSettingTab | null = null;
	/** 압축으로 교체된 옛 DB — 직전에 시작된 검색이 끝나도록 잠시 두었다가 닫는다 */
	private retiredDb: { db: Database; timer: number } | null = null;

	async onload() {
		await this.loadSettings();
		this.applyProtectedTerms();
		this.settingTab = new WeightedRecallSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

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
				await this.openRecallView(true);
			},
		});

		// 선택이 없어도 커서 문단으로 검색 — 단축키를 붙여 쓰기 좋은 명령.
		this.addCommand({
			id: "search-selection-or-paragraph",
			name: "선택 텍스트 또는 현재 문단으로 참고자료 검색",
			editorCallback: async (editor, ctx) => {
				const file = ctx.file;
				if (!file) return;
				const q = queryFromEditor(editor);
				if (!q) {
					new Notice(
						`A4P Sermon Desk: 검색할 내용이 너무 짧습니다 — ${MIN_SELECTION_CHARS}자 이상 선택하거나 커서를 ${MIN_PARAGRAPH_CHARS}자 이상인 문단 안에 두세요`,
					);
					return;
				}
				const view = await this.openRecallView(false);
				view?.searchWithText(q.text, file, q.mode);
			},
		});

		// 선택 텍스트를 아이디어 메모(새 노트)로 — 우클릭 메뉴와 같은 동작, 단축키 바인딩용.
		this.addCommand({
			id: "create-idea-memo",
			name: "선택 텍스트로 아이디어 메모 생성",
			editorCallback: (editor, ctx) => {
				void createIdeaMemo(this, editor, ctx.file ?? null);
			},
		});

		this.addRibbonIcon("search", "설교 준비 데스크 열기", () => {
			void this.openRecallView(true);
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				const file = info.file;
				// 선택이 있으면(길이 무관) 아이디어 메모 항목 — 원본 파일을 몰라도 메모는 만든다.
				if (editor.getSelection().trim()) {
					menu.addItem((item) =>
						item
							.setTitle("💡 아이디어 메모로 생성하기")
							.setIcon("lightbulb")
							.onClick(() => {
								void createIdeaMemo(this, editor, file ?? null);
							}),
					);
				}
				if (!file) return;
				// 메뉴 빌드 시점에 쿼리를 캡처 — 뷰를 여는 동안 active leaf가
				// 바뀌어도 검색 쿼리가 흔들리지 않는다. 선택이 짧으면 커서 문단.
				const q = queryFromEditor(editor);
				if (!q) return;
				menu.addItem((item) =>
					item
						.setTitle(
							q.mode === "selection"
								? "선택 텍스트로 참고자료 검색"
								: "현재 문단으로 참고자료 검색",
						)
						.setIcon("search")
						.onClick(async () => {
							const view = await this.openRecallView(false);
							view?.searchWithText(q.text, file, q.mode);
						}),
				);
			}),
		);

		// 볼트 삭제·이름 변경을 색인에 즉시 반영(행만 정리, 저장은 지연). 생성·수정은
		// 형태소·임베딩 비용 때문에 [재색인 (변경분만)] 버튼이 담당한다.
		// DB를 불러오기 전에 들어온 이벤트는 대기열에 쌓였다가 불러온 뒤 반영된다.
		this.registerEvent(
			this.app.vault.on("delete", (file) => this.onVaultDelete(file)),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) =>
				this.onVaultRename(file, oldPath),
			),
		);
		// index.db는 onload에서 읽지 않는다 — 옵시디언은 켤 때 플러그인 onload를 하나씩
		// 기다리고 3초가 넘으면 "taking long to load" 경고를 띄운다(옵시디언 안 실측:
		// 112MB 읽기 1~3초, 큰 볼트의 385MB면 수 초~10초).
		this.app.workspace.onLayoutReady(() => {
			void this.startDbLoad();
		});

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
						// ablation 4단 — 각 단계가 정확히 하나씩 더한다.
						// (applyOverlapBoost 기본값이 true라 명시하지 않으면 베이스라인이 오염됨)
						const stages = [
							{
								label: "RRF only",
								opts: {
									applyWeight: false,
									applyHeadingBoost: false,
									applyOverlapBoost: false,
									applyCosineBoost: false,
								},
							},
							{
								label: "+weight",
								opts: {
									applyWeight: true,
									applyHeadingBoost: false,
									applyOverlapBoost: false,
									applyCosineBoost: false,
								},
							},
							{
								label: "+heading",
								opts: {
									applyWeight: true,
									applyHeadingBoost: true,
									applyOverlapBoost: false,
									applyCosineBoost: false,
								},
							},
							{
								label: "+overlap",
								opts: {
									applyWeight: true,
									applyHeadingBoost: true,
									applyOverlapBoost: true,
									applyCosineBoost: false,
								},
							},
							{
								label: "+cosine",
								opts: {
									applyWeight: true,
									applyHeadingBoost: true,
									applyOverlapBoost: true,
									applyCosineBoost: true,
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

		if (__DEV__) {
			console.log("[a4p-sermon-desk] loaded BUILD=v11-a4p-rename");
		}
	}

	/** 오른쪽 패널의 RecallView를 찾거나 생성해 드러낸다. */
	private async openRecallView(focus: boolean): Promise<RecallView | null> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(RECALL_VIEW_TYPE)[0];
		if (!leaf) {
			const right = workspace.getRightLeaf(false);
			if (!right) return null;
			leaf = right;
			await leaf.setViewState({
				type: RECALL_VIEW_TYPE,
				active: focus,
			});
		}
		workspace.revealLeaf(leaf);
		return leaf.view instanceof RecallView ? leaf.view : null;
	}

	/** 설정 변경(자동 검색·테마·삽입 방식)을 열린 뷰들에 즉시 반영 (설정 탭에서 호출). */
	refreshRecallViewsUI(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			RECALL_VIEW_TYPE,
		)) {
			if (leaf.view instanceof RecallView) {
				leaf.view.updateAutoSearchUI();
				leaf.view.updateProfileUI();
				leaf.view.updateInsertModeUI();
				leaf.view.updateResultCountUI();
			}
		}
	}

	/** 열린 뷰들의 마지막 검색을 재실행 (결과 개수 등 검색 시점 설정 변경 시, 설정 탭에서 호출). */
	rerunRecallViewsSearch(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			RECALL_VIEW_TYPE,
		)) {
			if (leaf.view instanceof RecallView) leaf.view.rerunLastSearch();
		}
	}

	/** DB 지연 로드를 시작한다(이미 시작했으면 같은 약속을 돌려준다). */
	private startDbLoad(): Promise<void> {
		if (!this.dbLoad) this.dbLoad = this.loadDb();
		return this.dbLoad;
	}

	/** 지연 로드가 끝날 때까지 기다려 DB를 돌려준다 — 불러오는 중에 들어온 검색·작업용. 실패하면 null. */
	async whenDbReady(): Promise<Database | null> {
		await this.startDbLoad();
		return this.db;
	}

	private async loadDb(): Promise<void> {
		let db: Database;
		try {
			db = await loadOrCreateDb(this, () => this.markDbDirty());
		} catch (e) {
			this.dbStatus = "failed";
			console.error("[a4p-sermon-desk] index.db 불러오기 실패", e);
			new Notice(
				`A4P Sermon Desk: 색인을 불러오지 못했습니다 — ${(e as Error).message}`,
			);
			this.settingTab?.refreshIfShown();
			return;
		}
		if (this.unloaded) {
			db.close();
			return;
		}
		this.db = db;
		this.dbStatus = "ready";
		if (__DEV__) {
			const v = db.exec("SELECT value FROM meta WHERE key='schema_version'");
			const version = v[0]?.values[0]?.[0] ?? "?";
			console.log(`[a4p-sermon-desk] db loaded, schema=${version}`);
		}

		// 설정 마이그레이션이 일어났다면, 기존 인덱스의 그룹/가중치를 비파괴적으로 재적용
		if (this.migratedThisLoad) {
			try {
				this.dbDirty = true;
				const r = reapplyFolderSettings(
					db,
					this.settings,
					scanVault(this.app, this.settings).map((x) => x.path),
				);
				await this.persistDb();
				if (__DEV__) {
					console.log(
						`[a4p-sermon-desk] 마이그레이션 후 폴더 재적용: ${r.updated} notes, 미색인 ${r.missing}`,
					);
				}
			} catch (e) {
				console.error(
					"[a4p-sermon-desk] post-migration reapply failed",
					e,
				);
			}
		}

		// 불러오는 동안 쌓인 볼트 삭제·이름 변경 반영 — 작업 중이면 그 작업이 끝날 때 반영된다
		if (!this.busy) this.flushPendingVaultOps();
		this.settingTab?.refreshIfShown();
	}

	/** DB를 쓰는 작업을 한 번에 하나만 — 설정 탭의 임베딩 작업도 이 잠금을 쓴다(압축·재색인과 겹치지 않게). */
	async withBusy(fn: () => Promise<void>): Promise<void> {
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
			this.flushPendingVaultOps();
		}
	}

	// ── 볼트 삭제·이름 변경 실시간 반영 ──────────────────────────────

	private onVaultDelete(file: TAbstractFile): void {
		if (file instanceof TFolder) {
			this.queueVaultOp({ kind: "delete", path: file.path, isFolder: true });
		} else if (file instanceof TFile && file.extension === "md") {
			this.queueVaultOp({ kind: "delete", path: file.path, isFolder: false });
		}
	}

	private onVaultRename(file: TAbstractFile, oldPath: string): void {
		if (file instanceof TFolder) {
			this.queueVaultOp({
				kind: "rename",
				oldPath,
				newPath: file.path,
				isFolder: true,
			});
		} else if (file instanceof TFile) {
			if (file.extension === "md") {
				this.queueVaultOp({
					kind: "rename",
					oldPath,
					newPath: file.path,
					isFolder: false,
				});
			} else if (oldPath.endsWith(".md")) {
				// .md → 다른 확장자: 더는 색인 대상이 아니다
				this.queueVaultOp({ kind: "delete", path: oldPath, isFolder: false });
			}
		}
	}

	/** busy(재색인 등 열린 트랜잭션) 중이거나 DB를 아직 불러오는 중이면 대기열에, 아니면 즉시 반영. */
	private queueVaultOp(op: VaultOp): void {
		if (this.busy || !this.db) {
			this.pendingVaultOps.push(op);
			return;
		}
		this.applyVaultOps([op]);
	}

	private flushPendingVaultOps(): void {
		if (this.pendingVaultOps.length === 0) return;
		const ops = this.pendingVaultOps;
		this.pendingVaultOps = [];
		this.applyVaultOps(ops);
	}

	/**
	 * 행만 정리하고(ms 단위) 저장은 묶는다. 모든 연산은 멱등 — 옵시디언이 폴더와
	 * 하위 파일 이벤트를 둘 다 내도 두 번째는 no-op.
	 */
	private applyVaultOps(ops: VaultOp[]): void {
		const db = this.db;
		if (!db) return;
		let changed = 0;
		try {
			for (const op of ops) changed += this.applyVaultOp(db, op);
		} catch (e) {
			console.error(
				"[a4p-sermon-desk] vault event → index update failed",
				e,
			);
		}
		if (changed === 0) return;
		// 이름 변경은 chunks.note_path를 제자리에서 바꿔 COUNT+MAX 지문이 안 변한다
		resetBm25Cache();
		resetVectorCache();
		this.dbDirty = true;
		this.scheduleSave();
	}

	/** @returns 실제로 정리·이동한 노트 수 */
	private applyVaultOp(db: Database, op: VaultOp): number {
		if (op.kind === "delete") {
			if (op.isFolder) return deleteNotesUnderFolder(db, op.path).length;
			return deleteNoteRows(db, [op.path]);
		}
		if (!op.isFolder) {
			return renameNoteRows(
				db,
				op.oldPath,
				op.newPath,
				categorizeFile(op.newPath, this.settings),
			)
				? 1
				: 0;
		}
		const oldPrefix = op.oldPath.endsWith("/") ? op.oldPath : op.oldPath + "/";
		const newPrefix = op.newPath.endsWith("/") ? op.newPath : op.newPath + "/";
		let n = 0;
		for (const oldP of listNotesUnderFolder(db, op.oldPath)) {
			const newP = newPrefix + oldP.slice(oldPrefix.length);
			if (
				renameNoteRows(db, oldP, newP, categorizeFile(newP, this.settings))
			) {
				n++;
			}
		}
		return n;
	}

	/** 지연 저장 — 마지막 변경 후 일정 시간 뒤 한 번만 index.db를 쓴다(busy면 다시 미룸). */
	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			if (this.busy) {
				this.scheduleSave();
				return;
			}
			if (!this.dbDirty) return;
			this.persistDb().catch((e) =>
				console.error("[a4p-sermon-desk] deferred save failed", e),
			);
		}, VAULT_SAVE_DELAY_MS);
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
			this.dbDirty = true;
			const r = await embedMissingChunks(
				this.db,
				apiKey,
				(p) =>
					progress.setMessage(
						`A4P Sermon Desk: 임베딩 ${p.done}/${p.total}`,
					),
			);
			await this.persistDb();
			progress.hide();
			if (r.embedded === 0) {
				new Notice("A4P Sermon Desk: 임베딩할 청크가 없습니다");
			} else {
				new Notice(
					`A4P Sermon Desk: 임베딩 ${r.embedded}개 완료`,
				);
			}
			if (__DEV__) {
				console.log(
					`[a4p-sermon-desk] embed done: ${r.embedded} chunks`,
				);
			}
		} catch (e) {
			progress.hide();
			new Notice(
				`A4P Sermon Desk: 임베딩 실패 — ${(e as Error).message}`,
			);
			console.error("[a4p-sermon-desk] embed failed", e);
		}
	}

	async onunload() {
		// 아직 불러오는 중이면 loadDb가 끝나는 대로 DB를 닫는다
		this.unloaded = true;
		this.closeRetiredDb();
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (this.db) {
			// 변경분이 없으면 저장 생략 — 리로드 시 새 인스턴스의 onload와
			// 경합해 index.db가 유실되는 것을 막고, 불필요한 대용량 쓰기도 줄인다
			if (this.dbDirty) {
				try {
					await saveDb(this, this.db);
				} catch (e) {
					console.error(
						"[a4p-sermon-desk] save on unload failed",
						e,
					);
				}
			}
			this.db.close();
			this.db = null;
		}
		destroyMorpheme();
		if (this.styleEl) {
			this.styleEl.remove();
			this.styleEl = null;
		}
		if (__DEV__) {
			console.log("[a4p-sermon-desk] unloaded");
		}
	}

	async loadSettings() {
		const data = await this.loadData();
		const flat = migrateToFlat(data);
		if (flat) {
			this.settings = normalizeSettings(flat);
			this.migratedThisLoad = true;
			await this.saveSettings();
			if (__DEV__) {
				console.log(
					"[a4p-sermon-desk] 카테고리 → 평면 폴더 모델로 마이그레이션됨",
				);
			}
			return;
		}
		if (isValidSettings(data)) {
			const merged = Object.assign(
				{},
				DEFAULT_SETTINGS,
				data,
			) as WeightedRecallSettings;
			this.settings = normalizeSettings(merged);
			// v2 → v3: raw 데이터에 profiles가 없었으면 normalize가 방금 백필한 것 —
			// 저장하고, 지문 형식(v3) 변경에 맞춰 post-migration reapply를 태운다.
			// isValidSettings 가드로 타입은 v3처럼 보이지만 v2 데이터엔 profiles가 없다.
			const rawProfiles: unknown = data.profiles;
			// v3 → v4: lexicons 배열이 없으면 normalize가 교리 필드를 렉시콘으로 백필한 것.
			const rawLexicons: unknown = data.lexicons;
			if (
				!Array.isArray(rawProfiles) ||
				rawProfiles.length === 0 ||
				!Array.isArray(rawLexicons)
			) {
				this.migratedThisLoad = true;
				await this.saveSettings();
				if (__DEV__) {
					console.log(
						"[a4p-sermon-desk] 설정 마이그레이션: 테마 프로파일·어휘 사전 백필됨",
					);
				}
			}
			return;
		}
		const legacy = migrateLegacySettings(data);
		if (legacy) {
			this.settings = normalizeSettings(legacy);
			this.migratedThisLoad = true;
			await this.saveSettings();
			if (__DEV__) {
				console.log(
					"[a4p-sermon-desk] 초레거시 folderWeights 마이그레이션됨",
				);
			}
			return;
		}
		if (data) {
			console.warn(
				"[a4p-sermon-desk] 알 수 없는 설정 형식, 기본값으로 초기화",
			);
		}
		this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		await this.saveSettings();
	}

	async saveSettings() {
		// folders[].weight(구버전 호환 미러)를 활성 프로파일 값으로 동기화하는 단일 관문.
		mirrorActiveWeights(this.settings);
		await this.saveData(this.settings);
		this.applyProtectedTerms();
	}

	/** 현재 설정에서 형태소 보호 단어를 도출해 토크나이저에 주입(색인·쿼리 공통). */
	applyProtectedTerms(): void {
		setProtectedTerms(deriveProtectedTerms(this.settings));
	}

	/** 현재 보호 단어 지문 — 설정 탭 상태줄·색인 meta 비교용. */
	protectedFp(): string {
		return protectedFingerprint(deriveProtectedTerms(this.settings));
	}

	/** 형태소 색인(chunk_terms)만 재계산 — 임베딩 유지, API 비용 0. 설정 탭 버튼이 호출. */
	async runRetokenize(): Promise<void> {
		return this.withBusy(async () => {
			await this.whenDbReady();
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
				this.applyProtectedTerms();
				this.dbDirty = true;
				const r = await retokenizeAllChunks(
					this.db,
					this.protectedFp(),
					(done, total) =>
						progress.setMessage(
							`A4P Sermon Desk: 형태소 색인 재계산 ${done}/${total}`,
						),
				);
				await this.persistDb();
				progress.hide();
				new Notice(
					`A4P Sermon Desk: 형태소 색인 재계산 완료 — 청크 ${r.chunks}개, 토큰 ${r.terms}개 (임베딩 유지)`,
				);
			} catch (e) {
				progress.hide();
				new Notice(
					`A4P Sermon Desk: 형태소 색인 재계산 실패 — ${(e as Error).message}`,
				);
				console.error("[a4p-sermon-desk] retokenize failed", e);
			}
		});
	}

	/** 재색인(기본 변경분만, force면 전체) — 설정 탭 버튼이 호출. */
	async runReindex(force = false): Promise<void> {
		return this.withBusy(async () => {
			await this.whenDbReady();
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
				this.dbDirty = true;
				const result = await runIndex(
					this.app,
					this.db,
					this.settings,
					{
						force,
						protectedFp: this.protectedFp(),
						onProgress: (done, total) =>
							progress.setMessage(
								`A4P Sermon Desk: 인덱싱 ${done}/${total}`,
							),
					},
				);
				await this.persistDb();
				progress.hide();
				if (result.mode === "full") {
					new Notice(
						`A4P Sermon Desk: 전체 재색인 완료 — ${result.added} 노트, ${result.chunks} 청크`,
					);
				} else if (
					result.added + result.updated + result.removed ===
					0
				) {
					new Notice(
						`A4P Sermon Desk: 변경된 노트가 없습니다 (${result.unchanged}개 최신 상태)`,
					);
				} else {
					new Notice(
						`A4P Sermon Desk: 재색인 완료 — 추가 ${result.added} · 변경 ${result.updated} · 삭제 ${result.removed} (스킵 ${result.unchanged}), 청크 ${result.chunks}개`,
					);
				}
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
			await this.whenDbReady();
			if (!this.db) {
				new Notice("A4P Sermon Desk: DB가 로드되지 않았습니다");
				return;
			}
			try {
				this.dbDirty = true;
				const scopePaths = scanVault(this.app, this.settings).map(
					(r) => r.path,
				);
				const r = reapplyFolderSettings(
					this.db,
					this.settings,
					scopePaths,
				);
				await this.persistDb();
				if (r.missing > 0) {
					new Notice(
						`A4P Sermon Desk: 폴더 설정 재적용 — ${r.updated}개 노트. ⚠️ 새로 검색 범위에 들어온 노트 ${r.missing}개는 아직 색인되지 않았습니다 — [재색인 (변경분만)]을 눌러주세요.`,
						10000,
					);
				} else {
					new Notice(
						`A4P Sermon Desk: 폴더 설정 재적용 — ${r.updated}개 노트`,
					);
				}
			} catch (e) {
				new Notice(
					`A4P Sermon Desk: 재적용 실패 — ${(e as Error).message}`,
				);
				console.error("[a4p-sermon-desk] reapply failed", e);
			}
		});
	}

	/** 색인 압축 — 범위를 줄인 뒤 남는 빈 공간을 걷어낸다(내용·임베딩 그대로, API 비용 0). 설정 탭 버튼이 호출. */
	async runCompact(): Promise<void> {
		return this.withBusy(async () => {
			const old = await this.whenDbReady();
			if (!old) {
				new Notice("A4P Sermon Desk: DB가 로드되지 않았습니다");
				return;
			}
			const progress = new Notice("A4P Sermon Desk: 색인 압축 중…", 0);
			let r: CompactResult;
			try {
				r = await compactDb(this, old);
				this.dbDirty = false;
			} catch (e) {
				progress.hide();
				new Notice(
					`A4P Sermon Desk: 색인 압축 실패 — ${(e as Error).message} (색인 파일은 그대로입니다)`,
				);
				console.error("[a4p-sermon-desk] compact failed", e);
				return;
			}
			// 메모리의 DB도 압축 파일로 바꾼다 — 그대로 두면 다음 저장이 압축 전의 큰 이미지를 다시 쓴다.
			// 다시 열지 못하면 지금 DB(내용 동일)를 그대로 쓴다. 디스크엔 검사를 통과한 압축 파일이
			// 있으므로 다시 시작하면 그 파일로 열린다(그것도 실패하면 .bak 복구 경로).
			progress.hide();
			try {
				const fresh = await openDbFile(this);
				const chunks = (d: Database) =>
					d.exec("SELECT COUNT(*) FROM chunks")[0]?.values[0]?.[0];
				if (chunks(fresh) !== chunks(old)) {
					fresh.close();
					throw new Error("다시 연 색인의 청크 수가 다릅니다");
				}
				if (this.unloaded) {
					fresh.close();
					return;
				}
				this.db = fresh;
				this.retireDb(old);
				resetBm25Cache();
				resetVectorCache();
			} catch (e) {
				console.error("[a4p-sermon-desk] compacted reopen failed", e);
				new Notice(
					"A4P Sermon Desk: 색인 파일은 압축했지만 다시 불러오지 못했습니다. 옵시디언을 다시 시작해 주세요.",
				);
				return;
			}
			const mb = (b: number) => (b / 1048576).toFixed(1);
			new Notice(
				`A4P Sermon Desk: 색인 압축 완료 — ${mb(r.before)}MB → ${mb(r.after)}MB`,
			);
		});
	}

	/** 압축 전 DB는 바로 닫지 않는다 — 그 직전에 시작된 검색이 끝나도록 잠시 두었다가 닫는다(내용은 같다). */
	private retireDb(old: Database): void {
		this.closeRetiredDb();
		const timer = window.setTimeout(
			() => this.closeRetiredDb(),
			RETIRED_DB_CLOSE_MS,
		);
		this.retiredDb = { db: old, timer };
	}

	private closeRetiredDb(): void {
		if (!this.retiredDb) return;
		window.clearTimeout(this.retiredDb.timer);
		this.retiredDb.db.close();
		this.retiredDb = null;
	}

	/** DB가 변경되었음을 표시 — 다음 persistDb/unload에서 저장 대상이 된다 */
	markDbDirty(): void {
		this.dbDirty = true;
	}

	async persistDb() {
		if (!this.db) return;
		await saveDb(this, this.db);
		this.dbDirty = false;
	}
}
