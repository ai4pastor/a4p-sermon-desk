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
	const handleMouseDown = (e: MouseEvent) => {
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement | null;
		const splitEl = handle?.parentElement;
		if (!splitEl) return;
		const rect = splitEl.getBoundingClientRect();
		handle?.classList.add("is-dragging");
		document.body.classList.add("wr-noselect");
		const onMove = (mv: MouseEvent) => {
			const offsetY = mv.clientY - rect.top;
			const ratio = offsetY / rect.height;
			props.onDrag(ratio);
		};
		const onUp = () => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			handle?.classList.remove("is-dragging");
			document.body.classList.remove("wr-noselect");
		};
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
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
	} = props;

	const flags: string[] = [];
	if (hit.bm25Rank !== null) flags.push(`B${hit.bm25Rank}`);
	if (hit.vectorRank !== null) flags.push(`V${hit.vectorRank}`);
	if (hit.headingMatched) flags.push("H");
	if (hit.queryTermsTotal > 0) {
		flags.push(`${hit.matchedQueryTerms}/${hit.queryTermsTotal}`);
	}

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
				{hit.heading ? (
					<div class="wr-heading">{hit.heading}</div>
				) : null}
				<div
					class={`wr-preview${expanded ? " wr-hidden" : ""}`}
				>
					{highlightText(hit.preview, queryTerms)}
				</div>
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
