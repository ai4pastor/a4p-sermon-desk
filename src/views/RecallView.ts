import {
	ItemView,
	MarkdownView,
	Notice,
	TFile,
	WorkspaceLeaf,
	debounce,
	normalizePath,
	setIcon,
	type Debouncer,
} from "obsidian";
import type { Database } from "sql.js";
import type { GroupId, WeightedRecallSettings } from "../settings";
import { preloadMorpheme, tokenize } from "../morpheme";
import { hybridSearch, HybridHit } from "../search/hybrid";
import {
	extractQueryKeysWithSynonyms,
	buildSynonymTokenIndex,
	loadSearchLexicons,
	tagSearch,
	VEC_THRESHOLD_DOCTRINE,
	VEC_THRESHOLD_TAG,
	VEC_TOPK,
} from "../search/tag";
import { topVectorKeys } from "../search/vector";
import {
	loadAllKeyEmbeddings,
	getKeyEmbeddingFingerprint,
} from "../db/embeddings";
import { embedTexts, EMBEDDING_MODEL } from "../embedder/openai";
import { renderHitList, unmountHitList } from "./HitList";

export const RECALL_VIEW_TYPE = "a4p-sermon-desk-view";

const DEBOUNCE_MS = 2500;
const TOP_N = 10;
const MIN_PARAGRAPH_CHARS = 10;
const SELECTION_POLL_MS = 250;

export interface RecallViewHost {
	db: Database | null;
	settings: WeightedRecallSettings;
	saveSettings(): Promise<void>;
}

interface QueryContext {
	text: string;
	mode: "selection" | "paragraph" | "fullnote";
}

type RenderMode = QueryContext["mode"] | "tag";

interface RenderState {
	hits: HybridHit[];
	queryTerms: string[];
	mode: RenderMode;
}

interface CachedQuery {
	tokens: string[];
	embedding: Float32Array | null;
}

const QUERY_CACHE_MAX = 50;

export class RecallView extends ItemView {
	private host: RecallViewHost;
	private debouncedRefresh: Debouncer<[], void>;
	private statusEl: HTMLElement | null = null;
	private mountEl: HTMLElement | null = null;
	private currentTrackedPath: string | null = null;
	private selectionPollId: number | null = null;
	private lastSelection = "";
	private expandedChunkIds = new Set<number>();
	private semanticRender: RenderState | null = null;
	private tagRender: RenderState | null = null;
	private paused = false;
	private pauseToggleEl: HTMLButtonElement | null = null;
	private modeSemanticEl: HTMLButtonElement | null = null;
	private modeTagEl: HTMLButtonElement | null = null;
	private relevanceSliderEl: HTMLInputElement | null = null;
	private relevanceValueEl: HTMLElement | null = null;
	private relevanceSaveTimer: number | null = null;
	private pinnedHits: HybridHit[] = [];
	private activeTab: GroupId = "internal";
	private queryCache = new Map<string, CachedQuery>();
	private refreshGen = 0;
	private pinRatio = 0.33;
	private suppressAutoRefreshPath: string | null = null;
	private suppressTimer: number | null = null;
	private lastQueryCtx: { text: string; mode: QueryContext["mode"]; filePath: string } | null = null;
	private synonymIndex: Map<string, string[][]> = new Map();
	private synonymIndexSrc: Record<string, string[]> | null = null;
	private keyEmbeddings: {
		doctrine: Map<string, Float32Array>;
		tag: Map<string, Float32Array>;
		fp: string;
	} | null = null;

	constructor(leaf: WorkspaceLeaf, host: RecallViewHost) {
		super(leaf);
		this.host = host;
		this.debouncedRefresh = debounce(
			() => {
				void this.refresh();
			},
			DEBOUNCE_MS,
			true,
		);
	}

	getViewType(): string {
		return RECALL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "A4P Sermon Desk";
	}

	getIcon(): string {
		return "search";
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1] ?? this.containerEl;
		root.empty();
		root.addClass("wr-root");
		root.createEl("h4", { text: "A4P Sermon Desk", cls: "wr-h" });

		const controls = root.createDiv({ cls: "wr-controls" });
		this.pauseToggleEl = controls.createEl("button", {
			cls: "wr-btn-pause",
		});
		this.pauseToggleEl.addEventListener("click", () => this.togglePause());
		this.modeSemanticEl = controls.createEl("button", {
			cls: "wr-btn-mode wr-btn-mode-semantic",
		});
		this.modeSemanticEl.addEventListener("click", () =>
			void this.setSearchMode("semantic"),
		);
		setIcon(this.modeSemanticEl, "brain");
		this.modeSemanticEl.createSpan({ text: " 의미 검색" });
		this.modeTagEl = controls.createEl("button", {
			cls: "wr-btn-mode wr-btn-mode-tag",
		});
		this.modeTagEl.addEventListener("click", () =>
			void this.setSearchMode("tag"),
		);
		setIcon(this.modeTagEl, "tag");
		this.modeTagEl.createSpan({ text: " 태그 검색" });

		this.updatePauseUI();
		this.updateModeUI();

		const relevanceRow = root.createDiv({ cls: "wr-relevance" });
		relevanceRow.createSpan({
			text: "관련도",
			cls: "wr-relevance-label",
		});
		relevanceRow.createSpan({
			text: "엄격",
			cls: "wr-relevance-end wr-relevance-end-strict",
		});
		this.relevanceSliderEl = relevanceRow.createEl("input", {
			cls: "wr-relevance-slider",
			type: "range",
		});
		this.relevanceSliderEl.min = "0";
		this.relevanceSliderEl.max = "10";
		this.relevanceSliderEl.step = "1";
		this.relevanceSliderEl.value = String(
			this.host.settings.relevanceThreshold,
		);
		relevanceRow.createSpan({
			text: "유연",
			cls: "wr-relevance-end wr-relevance-end-loose",
		});
		this.relevanceValueEl = relevanceRow.createSpan({
			text: String(this.host.settings.relevanceThreshold),
			cls: "wr-relevance-value",
		});
		this.relevanceSliderEl.addEventListener("input", () =>
			this.handleRelevanceInput(),
		);

		this.statusEl = root.createEl("p", {
			text: "활성 노트를 분석합니다…",
			cls: "wr-status",
		});
		this.mountEl = root.createDiv({ cls: "wr-mount" });

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.scheduleRefresh();
			}),
		);
		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.scheduleRefresh();
			}),
		);

		this.selectionPollId = window.setInterval(() => {
			this.checkSelection();
		}, SELECTION_POLL_MS);

		this.scheduleRefresh();
	}

	async onClose(): Promise<void> {
		this.debouncedRefresh.cancel();
		if (this.selectionPollId !== null) {
			window.clearInterval(this.selectionPollId);
			this.selectionPollId = null;
		}
		if (this.suppressTimer !== null) {
			window.clearTimeout(this.suppressTimer);
			this.suppressTimer = null;
		}
		if (this.mountEl) {
			unmountHitList(this.mountEl);
		}
	}

	private checkSelection(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const sel = view?.editor.getSelection() ?? "";
		if (sel !== this.lastSelection) {
			this.lastSelection = sel;
			this.scheduleRefresh();
		}
	}

	private scheduleRefresh(): void {
		if (this.paused) return;
		const active = this.app.workspace.getActiveFile();
		if (active) {
			const activePath = normalizePath(active.path).normalize("NFC");
			if (this.suppressAutoRefreshPath === activePath) return;
			const inResult = this.allHitPaths().some(
				(p) => normalizePath(p).normalize("NFC") === activePath,
			);
			const inPinned = this.pinnedHits.some(
				(h) => normalizePath(h.notePath).normalize("NFC") === activePath,
			);
			if (inResult || inPinned) return;
			this.currentTrackedPath = active.path;
		}
		this.setStatus("검색 대기 중…");
		this.debouncedRefresh();
	}

	togglePause(): void {
		this.paused = !this.paused;
		this.updatePauseUI();
		if (!this.paused) {
			this.manualRefresh();
		}
	}

	manualRefresh(): void {
		void this.refresh({ manual: true });
	}

	private updatePauseUI(): void {
		if (!this.pauseToggleEl) return;
		this.pauseToggleEl.empty();
		if (this.paused) {
			setIcon(this.pauseToggleEl, "pause");
			this.pauseToggleEl.createSpan({ text: " 일시정지됨" });
			this.pauseToggleEl.addClass("is-paused");
			this.pauseToggleEl.setAttr("title", "클릭하여 자동 갱신 재개");
		} else {
			setIcon(this.pauseToggleEl, "play");
			this.pauseToggleEl.createSpan({ text: " 자동 갱신 중" });
			this.pauseToggleEl.removeClass("is-paused");
			this.pauseToggleEl.setAttr("title", "클릭하여 자동 갱신 일시정지");
		}
	}

	async setSearchMode(mode: "semantic" | "tag"): Promise<void> {
		if (this.host.settings.searchMode === mode) return;
		this.host.settings.searchMode = mode;
		await this.host.saveSettings();
		this.updateModeUI();
		if (this.getCurrentRender()) {
			this.doRender();
		} else {
			this.clearList();
			this.setStatus(
				mode === "tag"
					? "태그 검색 결과가 아직 없습니다. 문단을 선택해주세요."
					: "의미 검색 결과가 아직 없습니다. 문단을 선택해주세요.",
			);
		}
	}

	async toggleSearchMode(): Promise<void> {
		const next =
			this.host.settings.searchMode === "tag" ? "semantic" : "tag";
		await this.setSearchMode(next);
	}

	private handleRelevanceInput(): void {
		if (!this.relevanceSliderEl) return;
		const v = Math.max(
			0,
			Math.min(10, Math.round(Number(this.relevanceSliderEl.value))),
		);
		this.host.settings.relevanceThreshold = v;
		if (this.relevanceValueEl) this.relevanceValueEl.setText(String(v));
		this.doRender();
		if (this.relevanceSaveTimer !== null) {
			window.clearTimeout(this.relevanceSaveTimer);
		}
		this.relevanceSaveTimer = window.setTimeout(() => {
			void this.host.saveSettings();
			this.relevanceSaveTimer = null;
		}, 400);
	}

	private updateModeUI(): void {
		const mode = this.host.settings.searchMode;
		if (this.modeSemanticEl) {
			this.modeSemanticEl.toggleClass("is-active", mode === "semantic");
			this.modeSemanticEl.setAttr(
				"title",
				mode === "semantic"
					? "의미 검색 활성"
					: "클릭하여 의미 검색으로 전환",
			);
		}
		if (this.modeTagEl) {
			this.modeTagEl.toggleClass("is-active", mode === "tag");
			this.modeTagEl.setAttr(
				"title",
				mode === "tag"
					? "태그 검색 활성"
					: "클릭하여 태그 검색으로 전환",
			);
		}
	}

	private setStatus(text: string): void {
		if (this.statusEl) this.statusEl.setText(text);
	}

	private clearList(): void {
		if (this.mountEl) unmountHitList(this.mountEl);
	}

	private extractSelection(): string | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;
		const sel = view.editor.getSelection().trim();
		return sel.length >= MIN_PARAGRAPH_CHARS ? sel : null;
	}

	private extractParagraph(): string | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;
		const editor = view.editor;
		const cursor = editor.getCursor();
		const doc = editor.getValue();
		const lines = doc.split("\n");
		let start = cursor.line;
		let end = cursor.line;
		while (start > 0 && lines[start - 1].trim() !== "") start--;
		while (end < lines.length - 1 && lines[end + 1].trim() !== "") end++;
		const paragraph = lines.slice(start, end + 1).join("\n").trim();
		return paragraph.length >= MIN_PARAGRAPH_CHARS ? paragraph : null;
	}

	private resolveQuery(): QueryContext | null {
		const file = this.app.workspace.getActiveFile();
		const filePath = file?.path ?? null;
		const selection = this.extractSelection();
		if (selection) {
			if (filePath) {
				this.lastQueryCtx = { text: selection, mode: "selection", filePath };
			}
			return { text: selection, mode: "selection" };
		}
		const paragraph = this.extractParagraph();
		if (paragraph) {
			if (filePath) {
				this.lastQueryCtx = { text: paragraph, mode: "paragraph", filePath };
			}
			return { text: paragraph, mode: "paragraph" };
		}
		if (filePath && this.lastQueryCtx?.filePath === filePath) {
			return { text: this.lastQueryCtx.text, mode: this.lastQueryCtx.mode };
		}
		return null;
	}

	private modeLabel(mode: RenderMode): string {
		switch (mode) {
			case "selection":
				return "선택 영역";
			case "paragraph":
				return "현재 문단";
			case "fullnote":
				return "전체 노트";
			case "tag":
				return "태그 매칭";
		}
	}

	private async refresh(opts: { manual?: boolean } = {}): Promise<void> {
		const gen = ++this.refreshGen;
		const db = this.host.db;
		if (!db) {
			this.clearList();
			this.setStatus("DB가 로드되지 않았습니다");
			return;
		}
		const cntRow = db.exec("SELECT COUNT(*) FROM chunks")[0];
		const chunkCount = cntRow ? Number(cntRow.values[0][0]) : 0;
		if (chunkCount === 0) {
			this.clearList();
			this.setStatus(
				"아직 인덱싱된 노트가 없습니다. 'Reindex all notes' 명령을 먼저 실행해주세요.",
			);
			return;
		}

		const file = this.app.workspace.getActiveFile();
		if (!file || !(file instanceof TFile) || file.extension !== "md") {
			this.clearList();
			this.setStatus("활성 마크다운 노트가 없습니다");
			return;
		}

		if (!opts.manual) {
			const filePathNFC = normalizePath(file.path).normalize("NFC");
			if (this.suppressAutoRefreshPath === filePathNFC) return;
			const inResult = this.allHitPaths().some(
				(p) => normalizePath(p).normalize("NFC") === filePathNFC,
			);
			const inPinned = this.pinnedHits.some(
				(h) => normalizePath(h.notePath).normalize("NFC") === filePathNFC,
			);
			if (inResult || inPinned) return;
		}
		this.currentTrackedPath = file.path;

		const ctx = this.resolveQuery();
		if (!ctx) {
			if (this.getCurrentRender()) {
				this.setStatus(
					`선택/문단 없음 · 직전 결과 유지 (${file.basename})`,
				);
			} else {
				this.clearList();
				this.setStatus("문단을 선택하거나 커서를 단락에 두세요");
			}
			return;
		}
		this.setStatus(
			`${this.modeLabel(ctx.mode)} 검색 중… (${file.basename})`,
		);

		try {
			const apiKey = this.host.settings.openaiApiKey;
			// 토큰+임베딩을 한 번 계산해 의미·태그 경로가 공유 → 추가 API 호출 0.
			const cached = await this.getOrCompute(ctx.text, apiKey || null);
			if (gen !== this.refreshGen) return;
			const tagPromise = this.runTagSearch(
				gen,
				db,
				file,
				ctx,
				cached.embedding,
			);
			const semanticPromise = this.runSemanticSearch(
				gen,
				db,
				file,
				ctx,
				cached,
			);
			await Promise.all([tagPromise, semanticPromise]);
		} catch (e) {
			console.error("[a4p-sermon-desk][view] refresh failed", e);
			this.setStatus(`검색 실패: ${(e as Error).message}`);
		}
	}

	private async runSemanticSearch(
		gen: number,
		db: Database,
		file: TFile,
		ctx: QueryContext,
		cached: CachedQuery,
	): Promise<void> {
		const queryTerms = cached.tokens;
		const queryEmbedding = cached.embedding;
		const t0 = performance.now();
		const rawHits = hybridSearch(db, queryTerms, queryEmbedding, {
			topN: TOP_N * 3,
		});
		const ms = performance.now() - t0;
		const filtered = rawHits.filter((h) => h.notePath !== file.path);
		const deduped = this.dedupeHits(filtered).slice(0, TOP_N);
		if (gen !== this.refreshGen) return;
		console.log(
			`[a4p-sermon-desk][view] mode=${ctx.mode} query="${file.basename}" qchars=${ctx.text.length} terms=${queryTerms.length} vector=${queryEmbedding ? "yes" : "no"} → ${deduped.length} hits in ${ms.toFixed(1)}ms (raw=${rawHits.length})`,
		);
		this.renderHits({ hits: deduped, queryTerms, mode: ctx.mode });
	}

	private async runTagSearch(
		gen: number,
		db: Database,
		file: TFile,
		ctx: QueryContext,
		queryEmbedding: Float32Array | null,
	): Promise<void> {
		const synonyms = this.host.settings.doctrineSynonyms;
		if (this.synonymIndexSrc !== synonyms) {
			this.synonymIndex = await buildSynonymTokenIndex(synonyms);
			this.synonymIndexSrc = synonyms;
			if (gen !== this.refreshGen) return;
		}
		const lexicons = loadSearchLexicons(db);
		const keys = await extractQueryKeysWithSynonyms(
			ctx.text,
			lexicons,
			this.synonymIndex,
		);
		if (gen !== this.refreshGen) return;

		// 텍스트(정확·동의어)가 놓친 의미 유사 키를 벡터로 발견.
		// 임베딩(=API 키)이 없으면 통째 skip → 기존 정확+동의어 동작 그대로.
		if (queryEmbedding) {
			const fp = `${EMBEDDING_MODEL}:${getKeyEmbeddingFingerprint(db, "doctrine_embeddings", EMBEDDING_MODEL)}:${getKeyEmbeddingFingerprint(db, "tag_embeddings", EMBEDDING_MODEL)}`;
			if (!this.keyEmbeddings || this.keyEmbeddings.fp !== fp) {
				this.keyEmbeddings = {
					doctrine: loadAllKeyEmbeddings(
						db,
						"doctrine_embeddings",
						EMBEDDING_MODEL,
					),
					tag: loadAllKeyEmbeddings(db, "tag_embeddings", EMBEDDING_MODEL),
					fp,
				};
			}
			const dExclude = new Set([...keys.dExact, ...keys.dSyn]);
			for (const k of topVectorKeys(
				queryEmbedding,
				this.keyEmbeddings.doctrine,
				lexicons.doctrine,
				dExclude,
				VEC_THRESHOLD_DOCTRINE,
				VEC_TOPK,
			)) {
				keys.dVec.add(k);
			}
			for (const k of topVectorKeys(
				queryEmbedding,
				this.keyEmbeddings.tag,
				lexicons.tag,
				keys.tExact,
				VEC_THRESHOLD_TAG,
				VEC_TOPK,
			)) {
				keys.tVec.add(k);
			}
		}

		const allKeys = new Set([
			...keys.dExact,
			...keys.dSyn,
			...keys.dVec,
			...keys.tExact,
			...keys.tVec,
		]);
		if (allKeys.size === 0) {
			this.tagRender = {
				hits: [],
				queryTerms: [],
				mode: "tag",
			};
			if (this.host.settings.searchMode === "tag") this.doRender();
			return;
		}
		const t0 = performance.now();
		const rawHits = tagSearch(db, keys, this.app, {
			topN: TOP_N * 3,
			excludePath: file.path,
		});
		const hits = this.dedupeHits(rawHits).slice(0, TOP_N);
		const ms = performance.now() - t0;
		if (gen !== this.refreshGen) return;
		console.log(
			`[a4p-sermon-desk][view] tag-mode dExact=[${[...keys.dExact].join(",")}] dSyn=[${[...keys.dSyn].join(",")}] dVec=[${[...keys.dVec].join(",")}] tExact=[${[...keys.tExact].join(",")}] tVec=[${[...keys.tVec].join(",")}] → ${hits.length} hits in ${ms.toFixed(1)}ms`,
		);
		this.renderHits({
			hits,
			queryTerms: [...allKeys],
			mode: "tag",
		});
	}

	private renderHits(state: RenderState): void {
		const isTag = state.mode === "tag";
		if (isTag) this.tagRender = state;
		else this.semanticRender = state;
		const settingMode = this.host.settings.searchMode;
		const matches =
			(settingMode === "tag" && isTag) ||
			(settingMode !== "tag" && !isTag);
		if (matches) this.doRender();
	}

	private getCurrentRender(): RenderState | null {
		return this.host.settings.searchMode === "tag"
			? this.tagRender
			: this.semanticRender;
	}

	private allHitPaths(): string[] {
		const s = this.semanticRender?.hits.map((h) => h.notePath) ?? [];
		const t = this.tagRender?.hits.map((h) => h.notePath) ?? [];
		return [...s, ...t];
	}

	private doRender(): void {
		const state = this.getCurrentRender();
		if (!state) return;
		const t = this.host.settings.relevanceThreshold;
		const topScore = state.hits[0]?.finalScore ?? 0;
		const cutoff = topScore * (1 - t / 10);
		const filteredHits =
			t >= 10
				? state.hits
				: state.hits.filter((h) => h.finalScore >= cutoff);
		const pinnedChunkIds = new Set(this.pinnedHits.map((h) => h.chunkId));
		const unpinned = filteredHits.filter(
			(h) => !pinnedChunkIds.has(h.chunkId),
		);
		const visibleIds = new Set<number>();
		for (const h of filteredHits) visibleIds.add(h.chunkId);
		for (const h of this.pinnedHits) visibleIds.add(h.chunkId);
		for (const id of this.expandedChunkIds) {
			if (!visibleIds.has(id)) this.expandedChunkIds.delete(id);
		}
		// notes.category_id 컬럼에는 이제 그룹("internal"/"external")이 저장된다.
		const internalHits = unpinned.filter(
			(h) => h.categoryId !== "external",
		);
		const externalHits = unpinned.filter(
			(h) => h.categoryId === "external",
		);
		if (this.mountEl) {
			renderHitList(this.mountEl, {
				internalHits,
				externalHits,
				pinnedHits: this.pinnedHits.slice(),
				pinnedChunkIds,
				queryTerms: state.queryTerms,
				activeTab: this.activeTab,
				eagerRender: this.host.settings.eagerRender,
				pinRatio: this.pinRatio,
				app: this.app,
				component: this,
				expandedChunkIds: this.expandedChunkIds,
				onToggleExpand: (chunkId) => {
					if (this.expandedChunkIds.has(chunkId)) {
						this.expandedChunkIds.delete(chunkId);
					} else {
						this.expandedChunkIds.add(chunkId);
					}
					this.doRender();
				},
				onTogglePin: (chunkId, hit) => this.togglePin(chunkId, hit),
				onInsertLink: (h) => this.insertLink(h),
				onDragLink: (e, h) => this.handleDragLink(e, h),
				onTabChange: (tab) => this.setActiveTab(tab),
				onPinResize: (r) => this.setPinRatio(r),
				onOpenNote: (h) => this.openHit(h),
			});
		}
		const label = this.modeLabel(state.mode);
		const pinCount = this.pinnedHits.length;
		const total = internalHits.length + externalHits.length + pinCount;
		if (total === 0) {
			this.setStatus(`관련 자료를 찾지 못했습니다 (${label})`);
		} else {
			const parts: string[] = [
				`📝 ${internalHits.length}`,
				`🔗 ${externalHits.length}`,
			];
			if (pinCount > 0) parts.push(`📌 ${pinCount}`);
			const suffix = t < 10 ? ` · 관련도 ${t}/10` : "";
			this.setStatus(
				`${label} 기준 ${parts.join(" / ")}${suffix}`,
			);
		}
	}

	private togglePin(chunkId: number, hit: HybridHit): void {
		const idx = this.pinnedHits.findIndex((h) => h.chunkId === chunkId);
		if (idx >= 0) {
			this.pinnedHits.splice(idx, 1);
		} else {
			this.pinnedHits.unshift(hit);
			this.expandedChunkIds.add(chunkId);
		}
		this.doRender();
	}

	private setActiveTab(tab: GroupId): void {
		this.activeTab = tab;
		this.doRender();
	}

	private setPinRatio(r: number): void {
		this.pinRatio = Math.max(0.15, Math.min(0.7, r));
		this.doRender();
	}

	private queryCacheKey(text: string): string {
		let h1 = 0x811c9dc5;
		let h2 = 0x9e3779b9;
		for (let i = 0; i < text.length; i++) {
			const c = text.charCodeAt(i);
			h1 = Math.imul(h1 ^ c, 16777619);
			h2 = Math.imul(h2 ^ c, 2246822519);
		}
		return `${text.length}:${h1 >>> 0}:${h2 >>> 0}`;
	}

	private async getOrCompute(
		text: string,
		apiKey: string | null,
	): Promise<CachedQuery> {
		const key = this.queryCacheKey(text);
		const cached = this.queryCache.get(key);
		let tokens = cached?.tokens;
		let embedding: Float32Array | null = cached?.embedding ?? null;
		if (cached) {
			this.queryCache.delete(key);
		}
		if (!tokens) {
			await preloadMorpheme();
			tokens = await tokenize(text);
		}
		if (apiKey && !embedding) {
			try {
				const vecs = await embedTexts([text], apiKey);
				embedding = vecs[0] ?? null;
			} catch (e) {
				console.warn(
					"[a4p-sermon-desk][view] embedding failed",
					e,
				);
				embedding = null;
			}
		}
		const entry: CachedQuery = { tokens, embedding };
		this.queryCache.set(key, entry);
		if (this.queryCache.size > QUERY_CACHE_MAX) {
			const oldest = this.queryCache.keys().next().value;
			if (oldest !== undefined) this.queryCache.delete(oldest);
		}
		return entry;
	}

	private canonicalTitle(t: string): string {
		return t
			.replace(/\s+\d+$/, "")
			.replace(/\s+복사본(\s+\d+)?$/, "")
			.trim();
	}

	private dedupeHits(hits: HybridHit[]): HybridHit[] {
		const byPath = new Map<string, HybridHit>();
		for (const h of hits) {
			const cur = byPath.get(h.notePath);
			if (!cur || h.finalScore > cur.finalScore) byPath.set(h.notePath, h);
		}
		const byTitle = new Map<string, HybridHit>();
		for (const h of byPath.values()) {
			const titleKey = this.canonicalTitle(h.noteTitle);
			const cur = byTitle.get(titleKey);
			const better =
				!cur ||
				h.noteWeight > cur.noteWeight ||
				(h.noteWeight === cur.noteWeight && h.finalScore > cur.finalScore);
			if (better) byTitle.set(titleKey, h);
		}
		return [...byTitle.values()].sort((a, b) => b.finalScore - a.finalScore);
	}

	private async openHit(hit: HybridHit): Promise<void> {
		const target = normalizePath(hit.notePath).normalize("NFC");
		this.suppressAutoRefreshPath = target;
		if (this.suppressTimer !== null) {
			window.clearTimeout(this.suppressTimer);
		}
		this.suppressTimer = window.setTimeout(() => {
			if (this.suppressAutoRefreshPath === target) {
				this.suppressAutoRefreshPath = null;
			}
			this.suppressTimer = null;
		}, 800);
		await this.app.workspace.openLinkText(hit.notePath, "", "split");
	}

	private getSourcePath(): string {
		return (
			this.currentTrackedPath ??
			this.app.workspace.getActiveFile()?.path ??
			""
		);
	}

	private findMarkdownView(): MarkdownView | null {
		const active =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) return active;
		const tracked = this.currentTrackedPath;
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		if (tracked) {
			for (const leaf of leaves) {
				if (
					leaf.view instanceof MarkdownView &&
					leaf.view.file?.path === tracked
				) {
					return leaf.view;
				}
			}
		}
		for (const leaf of leaves) {
			if (leaf.view instanceof MarkdownView) return leaf.view;
		}
		return null;
	}

	private buildWikilink(hit: HybridHit): string {
		const file = this.app.vault.getAbstractFileByPath(hit.notePath);
		const sourcePath = this.getSourcePath();
		if (file instanceof TFile) {
			return this.app.fileManager.generateMarkdownLink(
				file,
				sourcePath,
				hit.heading ? `#${hit.heading}` : "",
			);
		}
		const name =
			hit.notePath.replace(/\.md$/, "").split("/").pop() ??
			hit.notePath;
		return hit.heading
			? `[[${name}#${hit.heading}]]`
			: `[[${name}]]`;
	}

	private insertLink(hit: HybridHit): void {
		const view = this.findMarkdownView();
		if (!view) {
			new Notice("A4P Sermon Desk: 마크다운 노트를 먼저 열어주세요");
			return;
		}
		const link = this.buildWikilink(hit);
		view.editor.replaceSelection(link);
		new Notice("A4P Sermon Desk: 링크 삽입됨");
	}

	private handleDragLink(e: DragEvent, hit: HybridHit): void {
		if (!e.dataTransfer) return;
		const link = this.buildWikilink(hit);
		e.dataTransfer.setData("text/plain", link);
		e.dataTransfer.effectAllowed = "copy";
	}
}
