import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { App, Component, MarkdownRenderer } from "obsidian";
import type { HybridHit } from "../search/hybrid";
import { type GroupId, internalToWeight10 } from "../settings";
import { isStopword } from "../morpheme";

export interface HitListProps {
	internalHits: HybridHit[];
	externalHits: HybridHit[];
	pinnedHits: HybridHit[];
	pinnedChunkIds: Set<number>;
	queryTerms: string[];
	activeTab: GroupId;
	eagerRender: boolean;
	pinRatio: number;
	app: App;
	component: Component;
	expandedChunkIds: Set<number>;
	onToggleExpand: (chunkId: number) => void;
	onTogglePin: (chunkId: number, hit: HybridHit) => void;
	onInsertLink: (hit: HybridHit) => void;
	onDragLink: (e: DragEvent, hit: HybridHit) => void;
	onTabChange: (tab: GroupId) => void;
	onPinResize: (ratio: number) => void;
	onOpenNote?: (hit: HybridHit) => void;
	onOpenPopup?: (hit: HybridHit) => void;
}

export function renderHitList(
	mountEl: HTMLElement,
	props: HitListProps,
): void {
	render(<HitList {...props} />, mountEl);
}

export function unmountHitList(mountEl: HTMLElement): void {
	render(null, mountEl);
}

function HitList(props: HitListProps) {
	const { internalHits, externalHits, pinnedHits } = props;
	if (
		internalHits.length === 0 &&
		externalHits.length === 0 &&
		pinnedHits.length === 0
	) {
		return null;
	}
	const groupOf = (h: HybridHit): GroupId =>
		h.categoryId === "external" ? "external" : "internal";
	const renderCard = (
		h: HybridHit,
		key: string,
		rank: number | null,
		isPinned: boolean,
	) => (
		<HitCard
			key={key}
			rank={rank}
			hit={h}
			groupId={groupOf(h)}
			queryTerms={props.queryTerms}
			app={props.app}
			component={props.component}
			expanded={props.expandedChunkIds.has(h.chunkId)}
			isPinned={isPinned}
			eagerRender={props.eagerRender}
			onToggle={() => props.onToggleExpand(h.chunkId)}
			onTogglePin={() => props.onTogglePin(h.chunkId, h)}
			onInsertLink={() => props.onInsertLink(h)}
			onDragLink={(e) => props.onDragLink(e, h)}
			onOpenNote={props.onOpenNote}
			onOpenPopup={props.onOpenPopup}
		/>
	);
	const hasPin = pinnedHits.length > 0;
	return (
		<div class="wr-list">
			{hasPin ? (
				<div
					class="wr-pin-section"
					style={{ flex: `${props.pinRatio} 1 0` }}
				>
					<div class="wr-pin-header">
						📌 고정됨 ({pinnedHits.length})
					</div>
					{pinnedHits.map((h) =>
						renderCard(h, `pinned-${h.chunkId}`, null, true),
					)}
				</div>
			) : null}
			{hasPin ? (
				<ResizeHandle onDrag={props.onPinResize} />
			) : null}
			<div
				class="wr-tabs-wrap"
				style={{ flex: `${hasPin ? 1 - props.pinRatio : 1} 1 0` }}
			>
				<div class="wr-tabs">
					<button
						class={`wr-tab-btn wr-tab-internal${
							props.activeTab === "internal" ? " is-active" : ""
						}`}
						onClick={() => props.onTabChange("internal")}
					>
						📝 내 메모 ({internalHits.length})
					</button>
					<button
						class={`wr-tab-btn wr-tab-external${
							props.activeTab === "external" ? " is-active" : ""
						}`}
						onClick={() => props.onTabChange("external")}
					>
						🔗 외부 자료 ({externalHits.length})
					</button>
				</div>
				<section
					class={`wr-tab-content${
						props.activeTab !== "internal" ? " wr-hidden" : ""
					}`}
				>
					{internalHits.length === 0 ? (
						<div class="wr-empty-section">
							이 영역에 해당하는 자료가 없습니다
						</div>
					) : (
						internalHits.map((h, i) =>
							renderCard(h, `int-${h.chunkId}`, i + 1, false),
						)
					)}
				</section>
				<section
					class={`wr-tab-content${
						props.activeTab !== "external" ? " wr-hidden" : ""
					}`}
				>
					{externalHits.length === 0 ? (
						<div class="wr-empty-section">
							이 영역에 해당하는 자료가 없습니다
						</div>
					) : (
						externalHits.map((h, i) =>
							renderCard(h, `ext-${h.chunkId}`, i + 1, false),
						)
					)}
				</section>
			</div>
		</div>
	);
}

function ResizeHandle(props: { onDrag: (ratio: number) => void }) {
	// 드래그 도중 언마운트되어도 document 리스너·body 클래스가 남지 않게.
	const dragCtrl = useRef<AbortController | null>(null);
	useEffect(() => () => dragCtrl.current?.abort(), []);
	const handleMouseDown = (e: MouseEvent) => {
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement | null;
		const splitEl = handle?.parentElement;
		if (!splitEl) return;
		const rect = splitEl.getBoundingClientRect();
		handle?.classList.add("is-dragging");
		document.body.classList.add("wr-noselect");
		dragCtrl.current?.abort();
		const ctrl = new AbortController();
		dragCtrl.current = ctrl;
		ctrl.signal.addEventListener("abort", () => {
			handle?.classList.remove("is-dragging");
			document.body.classList.remove("wr-noselect");
		});
		const onMove = (mv: MouseEvent) => {
			const offsetY = mv.clientY - rect.top;
			const ratio = offsetY / rect.height;
			props.onDrag(ratio);
		};
		const onUp = () => {
			ctrl.abort();
		};
		document.addEventListener("mousemove", onMove, {
			signal: ctrl.signal,
		});
		document.addEventListener("mouseup", onUp, { signal: ctrl.signal });
	};
	return (
		<div
			class="wr-resize-handle"
			onMouseDown={handleMouseDown}
			title="드래그하여 핀/메모 비율 조정"
		/>
	);
}

function HitCard(props: {
	rank: number | null;
	hit: HybridHit;
	groupId: GroupId;
	queryTerms: string[];
	app: App;
	component: Component;
	expanded: boolean;
	isPinned: boolean;
	eagerRender: boolean;
	onToggle: () => void;
	onTogglePin: () => void;
	onInsertLink: () => void;
	onDragLink: (e: DragEvent) => void;
	onOpenNote?: (h: HybridHit) => void;
	onOpenPopup?: (h: HybridHit) => void;
}) {
	const {
		rank,
		hit,
		groupId,
		queryTerms,
		app,
		component,
		expanded,
		isPinned,
		eagerRender,
		onToggle,
		onTogglePin,
		onInsertLink,
		onDragLink,
		onOpenNote,
		onOpenPopup,
	} = props;

	const flags: string[] = [];
	if (hit.bm25Rank !== null) flags.push(`B${hit.bm25Rank}`);
	if (hit.vectorRank !== null) flags.push(`V${hit.vectorRank}`);
	if (hit.headingMatched) flags.push("H");
	if (hit.queryTermsTotal > 0) {
		flags.push(`${hit.matchedQueryTerms}/${hit.queryTermsTotal}`);
	}

	const folder = folderOf(hit.notePath);
	const snippet = makeSnippet(hit.fullText, hit.preview, queryTerms);
	const chips = (hit.matchedKeys ?? []).slice(0, MAX_KEY_CHIPS);

	return (
		<div
			class={`wr-card wr-card-${groupId}${expanded ? " wr-card-expanded" : ""}${isPinned ? " wr-card-pinned" : ""}`}
			onClick={onToggle}
			draggable={true}
			onDragStart={onDragLink}
		>
			{isPinned && !expanded ? (
				<span class="wr-pin-marker">📌</span>
			) : null}
			<div class={`wr-rank${isPinned ? " wr-rank-pin" : ""}`}>
				{isPinned ? "📌" : rank}
			</div>
			<div class="wr-body">
				<div class="wr-title">{hit.noteTitle}</div>
				{folder ? (
					<div class="wr-path" title={folder}>
						{shortFolder(folder)}
					</div>
				) : null}
				{hit.heading ? (
					<div class="wr-heading">{hit.heading}</div>
				) : null}
				<div
					class={`wr-preview${expanded ? " wr-hidden" : ""}`}
				>
					{highlightText(snippet, queryTerms)}
				</div>
				{chips.length > 0 ? (
					<div class="wr-keychips">
						{chips.map((mk, i) => (
							<span
								key={i}
								class={`wr-keychip wr-keychip-${mk.kind}${mk.kind === "dVec" || mk.kind === "tVec" ? " is-vec" : ""}`}
								title={KEY_KIND_LABEL[mk.kind]}
							>
								{mk.key}
							</span>
						))}
						{(hit.matchedKeys?.length ?? 0) > MAX_KEY_CHIPS ? (
							<span class="wr-keychip-more">
								+{(hit.matchedKeys?.length ?? 0) - MAX_KEY_CHIPS}
							</span>
						) : null}
					</div>
				) : null}
				{eagerRender || expanded ? (
					<MarkdownPanel
						text={hit.fullText}
						sourcePath={hit.notePath}
						app={app}
						component={component}
						hidden={!expanded}
					/>
				) : null}
				<div class="wr-meta">
					<span class="wr-category">
						<span class="wr-weight">
							{internalToWeight10(hit.noteWeight)}/10
						</span>
					</span>
					{flags.length > 0 ? (
						<span class="wr-flags">{flags.join(" ")}</span>
					) : null}
				</div>
				{expanded ? (
					<div class="wr-actions">
						{onOpenNote ? (
							<button
								class="wr-open-btn"
								onClick={(e) => {
									e.stopPropagation();
									onOpenNote(hit);
								}}
							>
								노트 열기 →
							</button>
						) : null}
						{onOpenPopup ? (
							<button
								class="wr-popup-btn"
								onClick={(e) => {
									e.stopPropagation();
									onOpenPopup(hit);
								}}
							>
								🔍 팝업 보기
							</button>
						) : null}
						<button
							class="wr-link-btn"
							onClick={(e) => {
								e.stopPropagation();
								onInsertLink();
							}}
						>
							🔗 링크 삽입
						</button>
						<button
							class={`wr-pin-btn${isPinned ? " is-pinned" : ""}`}
							onClick={(e) => {
								e.stopPropagation();
								onTogglePin();
							}}
						>
							{isPinned ? "📌 핀 해제" : "📌 핀 고정"}
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}

function MarkdownPanel(props: {
	text: string;
	sourcePath: string;
	app: App;
	component: Component;
	hidden: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		let cancelled = false;
		const temp = document.createElement("div");
		void MarkdownRenderer.render(
			props.app,
			props.text,
			temp,
			props.sourcePath,
			props.component,
		)
			.then(() => {
				if (cancelled) return;
				el.empty();
				while (temp.firstChild) {
					el.appendChild(temp.firstChild);
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			el.empty();
		};
	}, [props.text, props.sourcePath]);
	return (
		<div
			class={`wr-fulltext wr-md${props.hidden ? " wr-hidden" : ""}`}
			ref={ref}
		/>
	);
}

const MAX_KEY_CHIPS = 6;

const KEY_KIND_LABEL: Record<string, string> = {
	dExact: "교리 키워드와 정확히 일치",
	dSyn: "교리 동의어로 일치",
	dVec: "의미가 비슷해 발견된 교리 (벡터)",
	tExact: "태그와 정확히 일치",
	tVec: "의미가 비슷해 발견된 태그 (벡터)",
};

function folderOf(notePath: string): string {
	const idx = notePath.lastIndexOf("/");
	return idx < 0 ? "" : notePath.slice(0, idx);
}

/** 사이드바 폭에 맞게 마지막 1~2 세그먼트만 표시 (전체는 title 속성). */
function shortFolder(folder: string): string {
	const parts = folder.split("/");
	return parts.length <= 2 ? folder : `…/${parts.slice(-2).join("/")}`;
}

const SNIPPET_LEN = 160;

/**
 * 미리보기를 검색어가 실제 매칭된 부근으로 만든다. 매칭 토큰이 본문 어디에도
 * 없으면(예: 태그 검색에서 키가 프론트매터에만 있는 경우) 기존 preview
 * (본문 앞부분)로 폴백. 하이라이트가 보이지 않는 무의미한 스니펫 방지.
 */
function makeSnippet(
	fullText: string,
	preview: string,
	terms: string[],
): string {
	const filtered = terms.filter((t) => t.length >= 2 && !isStopword(t));
	if (!fullText || filtered.length === 0) return preview;
	const lower = fullText.toLowerCase();
	let first = -1;
	for (const t of filtered) {
		const i = lower.indexOf(t.toLowerCase());
		if (i >= 0 && (first < 0 || i < first)) first = i;
	}
	if (first < 0) return preview;
	const start = Math.max(0, first - Math.floor(SNIPPET_LEN / 3));
	const end = Math.min(fullText.length, start + SNIPPET_LEN);
	return (
		(start > 0 ? "…" : "") +
		fullText.slice(start, end) +
		(end < fullText.length ? "…" : "")
	);
}

function highlightText(text: string, terms: string[]) {
	const filtered = terms.filter((t) => t.length >= 2 && !isStopword(t));
	if (filtered.length === 0) return text;
	const escaped = filtered
		.slice()
		.sort((a, b) => b.length - a.length)
		.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const re = new RegExp(`(${escaped.join("|")})`, "gi");
	const parts = text.split(re);
	return parts.map((p, i) =>
		i % 2 === 1 ? (
			<mark key={i} class="wr-mark">
				{p}
			</mark>
		) : (
			<span key={i}>{p}</span>
		),
	);
}
