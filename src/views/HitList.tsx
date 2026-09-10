import { render, type ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { App, Component, MarkdownRenderer } from "obsidian";
import type { HybridHit } from "../search/hybrid";
import { VECTOR_NOISE_THRESHOLD, VECTOR_STRONG_SIM } from "../search/hybrid";
import {
	explainHit,
	KIND_LABEL_KO,
	type HitExplanation,
} from "../search/explain";
import { type GroupId, type InsertMode, internalToWeight10 } from "../settings";
import { INSERT_LABEL } from "../insert";
import {
	buildTermRegex,
	makeSnippet,
	parseTagPrefix,
	splitByTerms,
	stripInlineMarkdown,
	stripTagPrefix,
} from "../markdown-text";
import { highlightRendered } from "./highlight-dom";

export interface HitListProps {
	internalHits: HybridHit[];
	externalHits: HybridHit[];
	pinnedHits: HybridHit[];
	pinnedChunkIds: Set<number>;
	queryTerms: string[];
	activeTab: GroupId;
	eagerRender: boolean;
	/** 🔬 분석 — 카드에 점수 막대·"왜 이 결과?" 표시. */
	showAnalysis: boolean;
	/** 현재 결과 1위 finalScore(상대 막대 기준). 핀 카드는 초과 가능 → clamp. */
	topScore: number;
	pinRatio: number;
	app: App;
	component: Component;
	expandedChunkIds: Set<number>;
	onToggleExpand: (chunkId: number) => void;
	onTogglePin: (chunkId: number, hit: HybridHit) => void;
	insertMode: InsertMode;
	onInsertLink: (hit: HybridHit, altKey: boolean) => void;
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
			insertMode={props.insertMode}
			showAnalysis={props.showAnalysis}
			topScore={props.topScore}
			onToggle={() => props.onToggleExpand(h.chunkId)}
			onTogglePin={() => props.onTogglePin(h.chunkId, h)}
			onInsertLink={(alt) => props.onInsertLink(h, alt)}
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
	insertMode: InsertMode;
	showAnalysis: boolean;
	topScore: number;
	onToggle: () => void;
	onTogglePin: () => void;
	onInsertLink: (altKey: boolean) => void;
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
		insertMode,
		showAnalysis,
		topScore,
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
	const snippet = makeSnippet(hit.fullText, queryTerms);
	const chips = (hit.matchedKeys ?? []).slice(0, MAX_KEY_CHIPS);
	// 노트 태그(색인 접두에서) — 매칭 근거 칩과 겹치는 것은 빼고 무채색 칩으로.
	const matchedKeySet = new Set((hit.matchedKeys ?? []).map((k) => k.key));
	const noteTags = parseTagPrefix(hit.fullText).filter(
		(t) => !matchedKeySet.has(t),
	);
	const ex = showAnalysis ? explainHit(hit, topScore) : null;

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
					<div class="wr-heading">
						{stripInlineMarkdown(hit.heading)}
					</div>
				) : null}
				{(hit.noteHitCount ?? 1) > 1 ? (
					<span
						class="wr-sibling-chip"
						title={`이 노트에서 관련 문단 ${(hit.noteHitCount ?? 1) - 1}개 더 매칭 — 가장 높은 문단만 표시`}
					>
						+{(hit.noteHitCount ?? 1) - 1} 문단
					</span>
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
				{noteTags.length > 0 ? (
					<div class="wr-tagchips">
						{noteTags.slice(0, MAX_TAG_CHIPS).map((t) => (
							<span
								key={t}
								class="wr-tagchip"
								title={`노트 태그: ${t}`}
							>
								#{t}
							</span>
						))}
						{noteTags.length > MAX_TAG_CHIPS ? (
							<span class="wr-keychip-more">
								+{noteTags.length - MAX_TAG_CHIPS}
							</span>
						) : null}
					</div>
				) : null}
				{eagerRender || expanded ? (
					<MarkdownPanel
						text={stripTagPrefix(hit.fullText)}
						sourcePath={hit.notePath}
						terms={queryTerms}
						app={app}
						component={component}
						hidden={!expanded}
					/>
				) : null}
				{ex ? <ScoreBar ex={ex} /> : null}
				{ex ? <WhyPanel ex={ex} hit={hit} /> : null}
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
							title="Option(Alt)+클릭: 반대 방식으로 삽입"
							onClick={(e) => {
								e.stopPropagation();
								onInsertLink(e.altKey);
							}}
						>
							{INSERT_LABEL[insertMode]}
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

// ── 🔬 분석: 점수 막대 + "왜 이 결과?" ─────────────────────────────

function fmt(n: number | null | undefined, digits: number): string {
	return n === null || n === undefined || !Number.isFinite(n)
		? "–"
		: n.toFixed(digits);
}

/**
 * 상대 관련도 막대. 길이 = 1위 대비 finalScore, 세그먼트 = 더해지는 성분의 비율
 * (의미 검색: 어휘 BM25 ⇄ 의미 벡터, 태그 검색: 교리 ⇄ 태그). 곱해지는 인자는 칩.
 */
export function ScoreBar({ ex }: { ex: HitExplanation }) {
	const pct = Math.round(ex.relative * 100);
	const isTag = ex.mode === "tag";
	const p = isTag ? "교리" : "어휘";
	const s = isTag ? "태그" : "의미";
	const w1 = ex.relative * ex.primaryShare * 100;
	const w2 = ex.relative * ex.secondaryShare * 100;
	const m = ex.multipliers;
	return (
		<div class="wr-score" onClick={(e) => e.stopPropagation()}>
			<div class="wr-score-row">
				<div
					class="wr-score-track"
					title={`1위 대비 ${pct}% — ${p} ${Math.round(ex.primaryShare * 100)}% · ${s} ${Math.round(ex.secondaryShare * 100)}%`}
				>
					<span class="wr-score-seg wr-score-seg-lex" style={{ width: `${w1}%` }} />
					<span class="wr-score-seg wr-score-seg-sem" style={{ width: `${w2}%` }} />
				</div>
				<span class="wr-score-pct">{pct}%</span>
			</div>
			<div class="wr-score-mults">
				<span class="wr-score-legend">
					<i class="wr-score-dot wr-score-seg-lex" />
					{p}
				</span>
				<span class="wr-score-legend">
					<i class="wr-score-dot wr-score-seg-sem" />
					{s}
				</span>
				<span class="wr-score-mult" title="폴더(테마) 가중치 배율">
					×{fmt(m.weight, 2)} 가중치
				</span>
				{m.heading !== 1 ? (
					<span class="wr-score-mult" title="헤딩(소제목)에 검색어가 있어 1.2배">
						×{fmt(m.heading, 1)} 제목
					</span>
				) : null}
				{ex.coverageApplied ? (
					<span
						class="wr-score-mult"
						title="검색어 포함률 보너스 = 1 + (일치/전체) × 0.5 (검색어 2개 이상일 때)"
					>
						×{fmt(m.coverage, 2)} 포함률
					</span>
				) : null}
				{m.cosine !== 1 ? (
					<span
						class="wr-score-mult"
						title={`의미 유사도 보너스 = 1 + (유사도−${VECTOR_NOISE_THRESHOLD})/(${VECTOR_STRONG_SIM}−${VECTOR_NOISE_THRESHOLD}) × 0.5`}
					>
						×{fmt(m.cosine, 2)} 의미
					</span>
				) : null}
			</div>
		</div>
	);
}

function WhyRow(props: { label: string; children: ComponentChildren }) {
	return (
		<div class="wr-why-row">
			<span class="wr-why-label">{props.label}</span>
			<span class="wr-why-value">{props.children}</span>
		</div>
	);
}

/** 카드 펼침과 독립적인 <details> — 클릭이 카드 토글로 올라가지 않게 막는다. */
function WhyPanel({ ex, hit }: { ex: HitExplanation; hit: HybridHit }) {
	const pct = Math.round(ex.relative * 100);
	const w10 = internalToWeight10(hit.noteWeight);
	return (
		<details class="wr-why" onClick={(e) => e.stopPropagation()}>
			<summary>🔬 왜 이 결과?</summary>
			<div class="wr-why-body">
				{ex.mode === "hybrid" && ex.hybrid ? (
					<WhyHybrid ex={ex} hit={hit} pct={pct} w10={w10} />
				) : ex.tag ? (
					<WhyTag ex={ex} hit={hit} pct={pct} w10={w10} />
				) : null}
			</div>
		</details>
	);
}

function WhyHybrid(props: {
	ex: HitExplanation;
	hit: HybridHit;
	pct: number;
	w10: number;
}) {
	const { ex, hit, pct, w10 } = props;
	const h = ex.hybrid!;
	const m = ex.multipliers;
	const missing = h.total - h.effectiveTerms;
	const noQuery = h.total === 0;
	let pass: string;
	if (!h.hasTrace) pass = "정보 없음";
	else if (noQuery) pass = "검색어 없음 — 의미 검색만 적용";
	else if (h.passedBy === "terms")
		pass = `검색어 ${h.matched}개 일치 (최소 ${h.requiredTerms}개)`;
	else if (h.passedBy === "vector")
		pass = `검색어 ${h.matched}/${h.requiredTerms}개로 부족하지만 의미 유사도 ${fmt(h.vectorScore, 2)} ≥ ${VECTOR_NOISE_THRESHOLD} 로 통과`;
	else if (h.passedBy === "both")
		pass = `검색어 ${h.matched}개 일치 + 의미 유사도 ${fmt(h.vectorScore, 2)} ≥ ${VECTOR_NOISE_THRESHOLD}`;
	else pass = "필터 미통과";
	const rrfB = h.hasTrace ? hit.trace!.rrfBm25 : 0;
	const rrfV = h.hasTrace ? hit.trace!.rrfVector : 0;
	return (
		<>
			<WhyRow label="일치한 검색어">
				{noQuery ? (
					<span class="wr-why-muted">없음 (의미 검색만)</span>
				) : (
					<>
						{h.matchedTerms.length > 0 ? (
							<span class="wr-why-terms">
								{h.matchedTerms.map((t) => (
									<span class="wr-why-term" key={t}>
										{t}
									</span>
								))}
							</span>
						) : (
							<span class="wr-why-muted">없음</span>
						)}{" "}
						<span class="wr-why-muted">
							{h.matched}/{h.total}
							{missing > 0 ? ` · 색인에 없는 단어 ${missing}개 제외` : ""}
						</span>
					</>
				)}
			</WhyRow>
			<WhyRow label="어휘 검색 (BM25)">
				{h.bm25Rank !== null ? (
					<>
						후보 {h.bm25Rank}위 · 점수 {fmt(h.bm25Score, 2)}
						{h.hasTrace ? ` → RRF ${fmt(rrfB, 4)}` : ""}
					</>
				) : (
					<span class="wr-why-muted">해당 없음 (단어로는 못 찾음)</span>
				)}
			</WhyRow>
			<WhyRow label="의미 검색 (벡터)">
				{h.vectorRank !== null ? (
					<>
						후보 {h.vectorRank}위 · 유사도 {fmt(h.vectorScore, 3)}
						{h.hasTrace ? ` → RRF ${fmt(rrfV, 4)}` : ""}
						{h.cosineMeter !== null ? (
							<span
								class="wr-why-meter"
								title={`유사도 ${fmt(h.vectorScore, 3)} — 잡음 문턱 ${VECTOR_NOISE_THRESHOLD} ~ 강한 일치 ${VECTOR_STRONG_SIM} 구간`}
							>
								<span style={{ width: `${Math.round(h.cosineMeter * 100)}%` }} />
							</span>
						) : null}
					</>
				) : (
					<span class="wr-why-muted">해당 없음 (의미로는 못 찾음)</span>
				)}
			</WhyRow>
			{h.hasTrace ? (
				<WhyRow label="합산 (RRF)">
					{fmt(rrfB, 4)} + {fmt(rrfV, 4)} = {fmt(ex.base, 4)}
				</WhyRow>
			) : (
				<WhyRow label="합산 (RRF)">{fmt(ex.base, 4)}</WhyRow>
			)}
			<WhyRow label="배율">
				× 가중치 {fmt(m.weight, 2)} ({w10}/10) · × 제목{" "}
				{m.heading !== 1 ? `${fmt(m.heading, 1)} (일치)` : "1.0 (없음)"} · ×
				포함률{" "}
				{ex.coverageApplied
					? fmt(m.coverage, 2)
					: `1.0 (검색어 ${h.total}개 — 2개 이상일 때만)`}{" "}
				· × 의미 유사도{" "}
				{h.vectorScore !== null ? fmt(m.cosine, 2) : "1.0 (벡터 없음)"}
			</WhyRow>
			<WhyRow label="최종 점수">
				{fmt(hit.finalScore, 5)}{" "}
				<span class="wr-why-muted">(1위 대비 {pct}%)</span>
			</WhyRow>
			<WhyRow label="잡음 필터">{pass}</WhyRow>
		</>
	);
}

function WhyTag(props: {
	ex: HitExplanation;
	hit: HybridHit;
	pct: number;
	w10: number;
}) {
	const { ex, hit, pct, w10 } = props;
	const t = ex.tag!;
	const sum = t.keys.map((k) => fmt(k.weight, k.weight % 1 ? 1 : 0)).join(" + ");
	return (
		<>
			<div class="wr-why-note">
				태그·교리 매칭 — 의미 검색과 다른 점수 체계입니다
			</div>
			<WhyRow label="근거 키">
				{t.keys.length === 0 ? (
					<span class="wr-why-muted">없음</span>
				) : (
					<span
						class="wr-why-keys"
						title="가중치: 교리 정확 3 / 교리 동의어 2 / 교리 의미 유사 1 / 태그 정확 1 / 태그 의미 유사 0.5"
					>
						{t.keys.map((k) => (
							<span class="wr-why-key" key={`${k.kind}:${k.key}`}>
								<b>{k.key}</b> · {KIND_LABEL_KO[k.kind]}
								{k.sim !== undefined ? ` · 유사도 ${fmt(k.sim, 2)}` : ""} ·{" "}
								<span class="wr-why-w">+{k.weight}</span>
							</span>
						))}
					</span>
				)}
			</WhyRow>
			<WhyRow label="합산">
				{t.keys.length > 1 ? `${sum} = ` : ""}
				{fmt(t.rawScore, 1)}
				<span class="wr-why-muted">
					{" "}
					(교리 {fmt(t.doctrineSum, 1)} · 태그 {fmt(t.tagSum, 1)})
				</span>
			</WhyRow>
			<WhyRow label="배율">
				× 가중치 {fmt(ex.multipliers.weight, 2)} ({w10}/10)
			</WhyRow>
			<WhyRow label="최종 점수">
				{fmt(hit.finalScore, 3)}{" "}
				<span class="wr-why-muted">(1위 대비 {pct}%)</span>
			</WhyRow>
			<div class="wr-why-note">
				미리보기는 매칭 키가 나오는 문단입니다 (없으면 첫 문단 — 태그·교리는
				프론트매터에만 있을 수 있음)
			</div>
		</>
	);
}

function MarkdownPanel(props: {
	text: string;
	sourcePath: string;
	/** 렌더 후 <mark>로 표시할 검색어. */
	terms: string[];
	app: App;
	component: Component;
	hidden: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	// 배열 identity는 매 렌더 바뀌므로 문자열 키로 의존성을 잡는다.
	const termsKey = props.terms.join("");
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
				highlightRendered(temp, props.terms);
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
	}, [props.text, props.sourcePath, termsKey]);
	return (
		<div
			class={`wr-fulltext wr-md${props.hidden ? " wr-hidden" : ""}`}
			ref={ref}
		/>
	);
}

const MAX_KEY_CHIPS = 6;
const MAX_TAG_CHIPS = 5;

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

/** 평문 텍스트에서 검색어를 <mark>로 감싼 JSX 조각. (스니펫 생성은 markdown-text.makeSnippet) */
export function highlightText(text: string, terms: string[]) {
	const re = buildTermRegex(terms);
	if (!re) return text;
	return splitByTerms(text, re).map((p, i) =>
		p.hit ? (
			<mark key={i} class="wr-mark">
				{p.text}
			</mark>
		) : (
			<span key={i}>{p.text}</span>
		),
	);
}
