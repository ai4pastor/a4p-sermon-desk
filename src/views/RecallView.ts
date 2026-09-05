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
import type { GroupId, InsertMode, WeightedRecallSettings } from "../settings";
import { getActiveProfile, makeWeightResolver } from "../settings";
import { buildCallout, calloutAlias, effectiveInsertMode } from "../insert";
import { preloadMorpheme, tokenize } from "../morpheme";
import { hybridSearch, HybridHit } from "../search/hybrid";
import { dedupeHits } from "../search/dedupe";
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
import {
	embedTexts,
	EMBEDDING_MODEL,
	MissingApiKeyError,
} from "../embedder/openai";
import { renderHitList, unmountHitList } from "./HitList";
import { renderChatPanel, unmountChatPanel } from "./ChatPanel";
import { AnswerPopupModal } from "./AnswerPopupModal";
import { NotePopupModal } from "./NotePopupModal";
import {
	MAX_CHUNKS_PER_NOTE,
	buildContext,
	buildChatMessages,
	capPerNote,
	maxContextCharsFor,
	type ChatMessage,
} from "../chat/rag";
import { chatComplete } from "../chat/complete";

declare const __DEV__: boolean;

export const RECALL_VIEW_TYPE = "a4p-sermon-desk-view";

const DEBOUNCE_MS = 2500;
const TOP_N = 10;
export const MIN_PARAGRAPH_CHARS = 10;
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
	private modeChatEl: HTMLButtonElement | null = null;
	private profileRowEl: HTMLElement | null = null;
	private insertRowEl: HTMLElement | null = null;
	/** 검색 ⇄ 채팅 화면 전환 (세션 전용 — 재시작 시 검색으로 시작). */
	private viewMode: "search" | "chat" = "search";
	private chatMountEl: HTMLElement | null = null;
	private searchUiEls: HTMLElement[] = [];
	private chatMessages: ChatMessage[] = [];
	private chatLoading = false;
	private chatLoadingText: string | null = null;
	private chatError: string | null = null;
	private chatAbort: AbortController | null = null;
	/** 펼쳐 둔 과거 문답 턴 (질문 메시지 인덱스). 최신 턴은 항상 펼침. */
	private expandedChatTurns = new Set<number>();
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
		this.modeSemanticEl.addEventListener("click", () => {
			this.setViewMode("search");
			void this.setSearchMode("semantic");
		});
		setIcon(this.modeSemanticEl, "brain");
		this.modeSemanticEl.createSpan({ text: " 의미 검색" });
		this.modeTagEl = controls.createEl("button", {
			cls: "wr-btn-mode wr-btn-mode-tag",
		});
		this.modeTagEl.addEventListener("click", () => {
			this.setViewMode("search");
			void this.setSearchMode("tag");
		});
		setIcon(this.modeTagEl, "tag");
		this.modeTagEl.createSpan({ text: " 태그 검색" });
		this.modeChatEl = controls.createEl("button", {
			cls: "wr-btn-mode wr-btn-mode-chat",
		});
		this.modeChatEl.addEventListener("click", () =>
			this.setViewMode("chat"),
		);
		setIcon(this.modeChatEl, "message-circle");
		this.modeChatEl.createSpan({ text: " 채팅" });

		this.updatePauseUI();
		this.updateModeUI();

		// 테마(프로파일) 칩 — 검색·채팅 모두에 적용되므로 searchUiEls에 넣지 않는다.
		this.profileRowEl = root.createDiv({ cls: "wr-profile-row" });
		this.updateProfileUI();

		// 삽입 방식 칩 — 검색 결과 전용이므로 searchUiEls에 넣어 채팅에서는 숨긴다.
		const insertRow = root.createDiv({ cls: "wr-profile-row" });
		this.insertRowEl = insertRow;
		this.updateInsertModeUI();

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
		this.chatMountEl = root.createDiv({
			cls: "wr-chat-mount wr-hidden",
		});
		this.searchUiEls = [insertRow, relevanceRow, this.statusEl, this.mountEl];

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

		// registerInterval — 뷰 언로드 시 Obsidian이 자동 정리 (onClose 수동 clear는 유지).
		this.selectionPollId = this.registerInterval(
			window.setInterval(() => {
				this.checkSelection();
			}, SELECTION_POLL_MS),
		);

		this.updateAutoSearchUI();
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
		if (this.relevanceSaveTimer !== null) {
			window.clearTimeout(this.relevanceSaveTimer);
			this.relevanceSaveTimer = null;
			// 대기 중이던 저장을 flush — 뷰를 빨리 닫아도 임계값 변경이 유실되지 않게.
			void this.host.saveSettings();
		}
		if (this.mountEl) {
			unmountHitList(this.mountEl);
		}
		this.chatAbort?.abort();
		this.chatAbort = null;
		if (this.chatMountEl) {
			unmountChatPanel(this.chatMountEl);
		}
	}

	private checkSelection(): void {
		if (!this.host.settings.autoSearch) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const sel = view?.editor.getSelection() ?? "";
		if (sel !== this.lastSelection) {
			this.lastSelection = sel;
			this.scheduleRefresh();
		}
	}

	private scheduleRefresh(): void {
		if (!this.host.settings.autoSearch) return;
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

	/** 우클릭 메뉴 등 외부 트리거용 — 캡처된 선택 텍스트로 즉시 검색. */
	searchWithText(text: string, file: TFile): void {
		this.lastQueryCtx = { text, mode: "selection", filePath: file.path };
		void this.refresh({
			manual: true,
			query: { text, mode: "selection" },
			file,
		});
	}

	/** 테마 칩 재구성 — 프로파일 CRUD·전환 시 호출 (설정 탭 → refreshRecallViewsUI 포함). */
	updateProfileUI(): void {
		const row = this.profileRowEl;
		if (!row) return;
		row.empty();
		const { profiles } = this.host.settings;
		// 프로파일이 1개뿐이면 칩 행 자체를 숨긴다.
		row.toggleClass("wr-hidden", profiles.length <= 1);
		if (profiles.length <= 1) return;
		const activeId = getActiveProfile(this.host.settings).id;
		row.createSpan({ text: "테마", cls: "wr-profile-label" });
		for (const p of profiles) {
			const btn = row.createEl("button", {
				text: p.name,
				cls: "wr-profile-chip",
			});
			btn.toggleClass("is-active", p.id === activeId);
			btn.setAttr(
				"title",
				p.id === activeId
					? `'${p.name}' 테마 사용 중`
					: `'${p.name}' 테마로 전환 — 재색인 없이 즉시 반영됩니다`,
			);
			btn.addEventListener("click", () => {
				void this.setActiveProfile(p.id);
			});
		}
	}

	/** 삽입 방식 칩 재구성 — 칩 클릭·설정 탭 변경 시 호출 (refreshRecallViewsUI 포함). */
	updateInsertModeUI(): void {
		const row = this.insertRowEl;
		if (!row) return;
		row.empty();
		const current = this.host.settings.insertMode;
		row.createSpan({ text: "삽입", cls: "wr-profile-label" });
		const chips: [InsertMode, string, string][] = [
			["link", "🔗 링크", "위키링크만 넣습니다"],
			[
				"callout",
				"💬 콜아웃",
				"매칭 문단을 인용 콜아웃으로 넣습니다 (제목 줄 링크로 백링크 유지)",
			],
		];
		for (const [mode, text, desc] of chips) {
			const btn = row.createEl("button", { text, cls: "wr-profile-chip" });
			btn.toggleClass("is-active", mode === current);
			btn.setAttr(
				"title",
				`${desc} — Option(Alt)을 누른 채 드래그·클릭하면 이번만 반대 방식`,
			);
			btn.addEventListener("click", () => {
				void this.setInsertMode(mode);
			});
		}
		// 카드 버튼 라벨(링크 삽입 ⇄ 콜아웃 삽입) 갱신 — 렌더 상태가 없으면 no-op.
		this.doRender();
	}

	private async setInsertMode(mode: InsertMode): Promise<void> {
		if (this.host.settings.insertMode === mode) return;
		this.host.settings.insertMode = mode;
		await this.host.saveSettings();
		this.updateInsertModeUI();
	}

	private async setActiveProfile(id: string): Promise<void> {
		if (this.host.settings.activeProfileId === id) return;
		this.host.settings.activeProfileId = id;
		await this.host.saveSettings();
		this.updateProfileUI();
		this.rerunLastSearch();
	}

	/**
	 * 마지막 검색을 같은 쿼리로 재실행 (테마 전환 반영용).
	 * refresh()를 그대로 부르면 사이드바 포커스 상태에서 getActiveFile()이 null이라
	 * 결과가 지워질 수 있어, lastQueryCtx의 파일·텍스트를 명시 전달한다.
	 * 쿼리 토큰·임베딩은 LRU 캐시 히트 → 추가 API 호출 0.
	 */
	private rerunLastSearch(): void {
		const ctx = this.lastQueryCtx;
		if (ctx) {
			const file = this.app.vault.getAbstractFileByPath(ctx.filePath);
			if (file instanceof TFile) {
				void this.refresh({
					manual: true,
					query: { text: ctx.text, mode: ctx.mode },
					file,
				});
				return;
			}
		}
		if (this.getCurrentRender()) {
			this.setStatus("테마 변경됨 — 다음 검색부터 적용됩니다.");
		}
	}

	/** autoSearch 설정 변화를 뷰에 반영 (설정 탭 토글·뷰 열기 시 호출). */
	updateAutoSearchUI(): void {
		const auto = this.host.settings.autoSearch;
		this.pauseToggleEl?.toggle(auto && this.viewMode === "search");
		if (auto) {
			this.scheduleRefresh();
		} else if (!this.getCurrentRender()) {
			this.setStatus(
				"수동 검색 모드 — 텍스트를 선택하고 우클릭 → '선택 텍스트로 참고자료 검색'을 누르세요.",
			);
		}
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

	setViewMode(mode: "search" | "chat"): void {
		if (this.viewMode === mode) return;
		this.viewMode = mode;
		const chat = mode === "chat";
		for (const el of this.searchUiEls) el.toggleClass("wr-hidden", chat);
		this.chatMountEl?.toggleClass("wr-hidden", !chat);
		// 일시정지 버튼은 검색 전용 컨트롤.
		this.pauseToggleEl?.toggle(this.host.settings.autoSearch && !chat);
		this.updateModeUI();
		if (chat) this.renderChat();
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
		const chat = this.viewMode === "chat";
		const mode = this.host.settings.searchMode;
		if (this.modeSemanticEl) {
			this.modeSemanticEl.toggleClass(
				"is-active",
				!chat && mode === "semantic",
			);
			this.modeSemanticEl.setAttr(
				"title",
				!chat && mode === "semantic"
					? "의미 검색 활성"
					: "클릭하여 의미 검색으로 전환",
			);
		}
		if (this.modeTagEl) {
			this.modeTagEl.toggleClass("is-active", !chat && mode === "tag");
			this.modeTagEl.setAttr(
				"title",
				!chat && mode === "tag"
					? "태그 검색 활성"
					: "클릭하여 태그 검색으로 전환",
			);
		}
		if (this.modeChatEl) {
			this.modeChatEl.toggleClass("is-active", chat);
			this.modeChatEl.setAttr(
				"title",
				chat
					? "채팅 활성 — 노트를 근거로 질문에 답합니다"
					: "클릭하여 채팅으로 전환",
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

	private async refresh(
		opts: { manual?: boolean; query?: QueryContext; file?: TFile } = {},
	): Promise<void> {
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

		const file = opts.file ?? this.app.workspace.getActiveFile();
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

		const ctx = opts.query ?? this.resolveQuery();
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
			// 활성 테마 프로파일 가중치 해석기 — 의미·태그가 메모이즈를 공유.
			const resolveWeight = makeWeightResolver(this.host.settings);
			const tagPromise = this.runTagSearch(
				gen,
				db,
				file,
				ctx,
				cached.embedding,
				resolveWeight,
			);
			const semanticPromise = this.runSemanticSearch(
				gen,
				db,
				file,
				ctx,
				cached,
				resolveWeight,
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
		resolveWeight: (notePath: string) => number,
	): Promise<void> {
		const queryTerms = cached.tokens;
		const queryEmbedding = cached.embedding;
		const t0 = performance.now();
		const rawHits = hybridSearch(db, queryTerms, queryEmbedding, {
			topN: TOP_N * 3,
			resolveWeight,
		});
		const ms = performance.now() - t0;
		const filtered = rawHits.filter((h) => h.notePath !== file.path);
		const deduped = dedupeHits(filtered).slice(0, TOP_N);
		if (gen !== this.refreshGen) return;
		if (__DEV__) {
			console.log(
				`[a4p-sermon-desk][view] mode=${ctx.mode} query="${file.basename}" qchars=${ctx.text.length} terms=${queryTerms.length} vector=${queryEmbedding ? "yes" : "no"} → ${deduped.length} hits in ${ms.toFixed(1)}ms (raw=${rawHits.length})`,
			);
		}
		this.renderHits({ hits: deduped, queryTerms, mode: ctx.mode });
	}

	private async runTagSearch(
		gen: number,
		db: Database,
		file: TFile,
		ctx: QueryContext,
		queryEmbedding: Float32Array | null,
		resolveWeight: (notePath: string) => number,
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
			resolveWeight,
		});
		const hits = dedupeHits(rawHits).slice(0, TOP_N);
		const ms = performance.now() - t0;
		if (gen !== this.refreshGen) return;
		if (__DEV__) {
			console.log(
				`[a4p-sermon-desk][view] tag-mode dExact=[${[...keys.dExact].join(",")}] dSyn=[${[...keys.dSyn].join(",")}] dVec=[${[...keys.dVec].join(",")}] tExact=[${[...keys.tExact].join(",")}] tVec=[${[...keys.tVec].join(",")}] → ${hits.length} hits in ${ms.toFixed(1)}ms`,
			);
		}
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
				insertMode: this.host.settings.insertMode,
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
				onInsertLink: (h, alt) => this.insertLink(h, alt),
				onDragLink: (e, h) => this.handleDragLink(e, h),
				onTabChange: (tab) => this.setActiveTab(tab),
				onPinResize: (r) => this.setPinRatio(r),
				onOpenNote: (h) => this.openHit(h),
				onOpenPopup: (h) =>
					new NotePopupModal(
						{
							app: this.app,
							openHit: (hit, pane) => this.openHit(hit, pane),
							insertMode: this.host.settings.insertMode,
							insertLink: (hit, alt) => this.insertLink(hit, alt),
						},
						h,
					).open(),
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

	// ── 채팅 (노트 기반 RAG) ──

	private renderChat(): void {
		if (!this.chatMountEl) return;
		const openSourcePopup = (h: HybridHit): void =>
			new NotePopupModal(
				{
					app: this.app,
					openHit: (hit, pane) => this.openHit(hit, pane),
					insertMode: this.host.settings.insertMode,
					insertLink: (hit, alt) => this.insertLink(hit, alt),
				},
				h,
			).open();
		renderChatPanel(this.chatMountEl, {
			messages: this.chatMessages,
			loading: this.chatLoading,
			loadingText: this.chatLoadingText,
			error: this.chatError,
			expandedTurns: this.expandedChatTurns,
			app: this.app,
			component: this,
			onSend: (text) => void this.sendChatMessage(text),
			onNewConversation: () => this.newConversation(),
			onToggleTurn: (qIdx) => {
				if (this.expandedChatTurns.has(qIdx)) {
					this.expandedChatTurns.delete(qIdx);
				} else {
					this.expandedChatTurns.add(qIdx);
				}
				this.renderChat();
			},
			onExpandAnswer: (message) => {
				const idx = this.chatMessages.indexOf(message);
				const q =
					idx > 0 && this.chatMessages[idx - 1].role === "user"
						? this.chatMessages[idx - 1].content
						: "";
				new AnswerPopupModal(
					this.app,
					q,
					message,
					openSourcePopup,
				).open();
			},
			onOpenSource: (h) => void this.openHit(h),
			onOpenSourcePopup: openSourcePopup,
		});
	}

	private newConversation(): void {
		this.chatAbort?.abort();
		this.chatAbort = null;
		this.chatMessages = [];
		this.chatLoading = false;
		this.chatLoadingText = null;
		this.chatError = null;
		this.expandedChatTurns.clear();
		this.renderChat();
	}

	private async sendChatMessage(text: string): Promise<void> {
		if (this.chatLoading) return;
		this.chatError = null;

		const db = this.host.db;
		if (!db) {
			this.chatError = "DB가 로드되지 않았습니다.";
			this.renderChat();
			return;
		}
		const cntRow = db.exec("SELECT COUNT(*) FROM chunks")[0];
		const chunkCount = cntRow ? Number(cntRow.values[0][0]) : 0;
		if (chunkCount === 0) {
			this.chatError =
				"아직 인덱싱된 노트가 없습니다. 설정 탭에서 재색인을 먼저 실행해주세요.";
			this.renderChat();
			return;
		}
		const apiKey = this.host.settings.openaiApiKey;
		if (!apiKey || !apiKey.trim()) {
			this.chatError =
				"채팅에는 OpenAI API 키가 필요합니다. 설정 탭에서 키를 입력해주세요.";
			this.renderChat();
			return;
		}

		this.chatMessages.push({ role: "user", content: text });
		this.chatLoading = true;
		this.chatLoadingText = "관련 노트 검색 중";
		this.renderChat();

		const abort = new AbortController();
		this.chatAbort?.abort();
		this.chatAbort = abort;

		try {
			const cached = await this.getOrCompute(text, apiKey);
			if (this.chatAbort !== abort) return;
			const topK = this.host.settings.chatTopK;
			// 채팅 RAG에도 활성 테마 가중치 적용 — 소스 선정이 테마 의도와 일관되게.
			const rawHits = hybridSearch(db, cached.tokens, cached.embedding, {
				topN: topK * 3,
				resolveWeight: makeWeightResolver(this.host.settings),
			});
			const hits = capPerNote(rawHits, MAX_CHUNKS_PER_NOTE).slice(
				0,
				topK,
			);
			// 총량 캡이 사용자가 고른 개수를 깎지 않도록 개수에 비례해 전달.
			const ctx = buildContext(hits, maxContextCharsFor(topK));
			this.chatLoadingText =
				ctx.used.length > 0
					? `노트 ${ctx.used.length}개를 참고해 답변 생성 중`
					: "답변 생성 중";
			this.renderChat();
			// 히스토리에는 최신 질문을 제외한 이전 턴만 넣는다.
			const history = this.chatMessages.slice(0, -1);
			const messages = buildChatMessages(history, text, ctx.block);
			const answer = await chatComplete(
				messages,
				this.host.settings.chatModel,
				apiKey,
				abort.signal,
			);
			if (this.chatAbort !== abort) return;
			this.chatMessages.push({
				role: "assistant",
				content: answer,
				sources: ctx.used,
			});
		} catch (e) {
			if (this.chatAbort !== abort) return;
			if (e instanceof MissingApiKeyError) {
				this.chatError =
					"채팅에는 OpenAI API 키가 필요합니다. 설정 탭에서 키를 입력해주세요.";
			} else {
				console.error("[a4p-sermon-desk][chat] failed", e);
				this.chatError = (e as Error).message;
			}
		} finally {
			if (this.chatAbort === abort) {
				this.chatLoading = false;
				this.chatLoadingText = null;
				this.chatAbort = null;
				this.renderChat();
			}
		}
	}

	private async openHit(
		hit: HybridHit,
		pane: "split" | "tab" = "split",
	): Promise<void> {
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
		await this.app.workspace.openLinkText(hit.notePath, "", pane);
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

	private buildWikilink(hit: HybridHit, alias?: string): string {
		const file = this.app.vault.getAbstractFileByPath(hit.notePath);
		const sourcePath = this.getSourcePath();
		if (file instanceof TFile) {
			return this.app.fileManager.generateMarkdownLink(
				file,
				sourcePath,
				hit.heading ? `#${hit.heading}` : "",
				alias,
			);
		}
		const name =
			hit.notePath.replace(/\.md$/, "").split("/").pop() ??
			hit.notePath;
		const tail = alias ? `|${alias}` : "";
		return hit.heading
			? `[[${name}#${hit.heading}${tail}]]`
			: `[[${name}${tail}]]`;
	}

	/** 매칭 청크를 제목 줄 링크(제목 › 헤딩)가 달린 인용 콜아웃으로. */
	private buildCalloutBlock(hit: HybridHit): string {
		const link = this.buildWikilink(
			hit,
			calloutAlias(hit.noteTitle, hit.heading),
		);
		return buildCallout(link, hit.fullText);
	}

	private insertLink(hit: HybridHit, altKey = false): void {
		const view = this.findMarkdownView();
		if (!view) {
			new Notice("A4P Sermon Desk: 마크다운 노트를 먼저 열어주세요");
			return;
		}
		const mode = effectiveInsertMode(this.host.settings.insertMode, altKey);
		if (mode === "link") {
			view.editor.replaceSelection(this.buildWikilink(hit));
			new Notice("A4P Sermon Desk: 링크 삽입됨");
			return;
		}
		// 콜아웃은 블록이라 자기 줄에서 시작해야 하고, 커서 뒤 텍스트가
		// 인용에 흡수(lazy continuation)되지 않게 빈 줄로 끊는다.
		const { editor } = view;
		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		const before = editor.getLine(from.line).slice(0, from.ch);
		const after = editor.getLine(to.line).slice(to.ch);
		const prefix = before.trim() ? "\n" : "";
		const suffix = after.trim() ? "\n" : "";
		editor.replaceSelection(prefix + this.buildCalloutBlock(hit) + suffix);
		new Notice("A4P Sermon Desk: 콜아웃 삽입됨");
	}

	private handleDragLink(e: DragEvent, hit: HybridHit): void {
		if (!e.dataTransfer) return;
		const mode = effectiveInsertMode(this.host.settings.insertMode, e.altKey);
		// 드롭 위치를 dragstart 시점엔 모르므로 콜아웃은 앞뒤 개행으로 자기완결:
		// 앞 \n = 문단 중간에 떨어져도 자기 줄에서 시작, 뒤 \n = 다음 문단 흡수 방지.
		const payload =
			mode === "link"
				? this.buildWikilink(hit)
				: `\n${this.buildCalloutBlock(hit)}\n`;
		e.dataTransfer.setData("text/plain", payload);
		e.dataTransfer.effectAllowed = "copy";
	}
}
