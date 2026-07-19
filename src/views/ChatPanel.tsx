import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { App, Component, MarkdownRenderer, Notice } from "obsidian";
import type { HybridHit } from "../search/hybrid";
import { parseCiteNumbers, type ChatMessage } from "../chat/rag";

export interface ChatPanelProps {
	messages: ChatMessage[];
	loading: boolean;
	/** 로딩 단계 안내 문구 ("관련 노트 검색 중…" 등). */
	loadingText: string | null;
	error: string | null;
	/** 펼쳐진 과거 턴의 질문 메시지 인덱스 (최신 턴은 항상 펼침). */
	expandedTurns: Set<number>;
	app: App;
	component: Component;
	onSend: (text: string) => void;
	onNewConversation: () => void;
	onToggleTurn: (qIdx: number) => void;
	onExpandAnswer: (message: ChatMessage) => void;
	onOpenSource: (hit: HybridHit) => void;
	onOpenSourcePopup: (hit: HybridHit) => void;
}

const EXAMPLE_QUESTIONS = [
	"'은혜'를 내 설교에서 어떻게 정의했었지?",
	"시편 23편 관련 내 묵상을 요약해줘",
	"청소년 설교에 쓸 만한 십자가 예화가 있을까?",
];

export function renderChatPanel(
	mountEl: HTMLElement,
	props: ChatPanelProps,
): void {
	render(<ChatPanel {...props} />, mountEl);
}

export function unmountChatPanel(mountEl: HTMLElement): void {
	render(null, mountEl);
}

/** 질문(user) 기준으로 대화를 턴 단위로 묶는다. */
interface Turn {
	qIdx: number;
	question: ChatMessage;
	answer: ChatMessage | null;
}

function buildTurns(messages: ChatMessage[]): Turn[] {
	const turns: Turn[] = [];
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (m.role === "user") {
			turns.push({ qIdx: i, question: m, answer: null });
		} else if (turns.length > 0) {
			turns[turns.length - 1].answer = m;
		}
	}
	return turns;
}

function ChatPanel(props: ChatPanelProps) {
	const listRef = useRef<HTMLDivElement>(null);
	const latestTurnRef = useRef<HTMLDivElement>(null);
	const prevCountRef = useRef(props.messages.length);

	// 답변 완료: 답변의 "시작"으로 스크롤 (긴 답변을 처음부터 읽도록).
	useEffect(() => {
		const grew = props.messages.length > prevCountRef.current;
		prevCountRef.current = props.messages.length;
		const last = props.messages[props.messages.length - 1];
		if (grew && last?.role === "assistant") {
			latestTurnRef.current?.scrollIntoView({ block: "start" });
		}
	}, [props.messages.length]);

	// 질문 전송·로딩 중: 아래로 따라가 진행 상태를 보여준다.
	useEffect(() => {
		if (!props.loading && !props.error) return;
		const el = listRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [props.loading, props.loadingText, props.error]);

	const turns = buildTurns(props.messages);
	const empty = turns.length === 0 && !props.loading && !props.error;

	return (
		<div class="wr-chat">
			<div class="wr-chat-header">
				<span class="wr-chat-header-title">💬 노트에게 질문하기</span>
				<button
					class="wr-chat-new-btn"
					disabled={props.messages.length === 0 && !props.error}
					onClick={props.onNewConversation}
					title="대화 내용을 지우고 새로 시작"
				>
					새 대화
				</button>
			</div>
			<div class="wr-chat-messages" ref={listRef}>
				{empty ? (
					<div class="wr-chat-empty">
						<div class="wr-chat-empty-icon">📖</div>
						<div class="wr-chat-empty-title">
							내 노트를 근거로 답하는 채팅입니다
						</div>
						<div class="wr-chat-empty-desc">
							답변의 <span class="wr-chat-cite-demo">1</span> 번호를
							누르면 근거 노트를 바로 볼 수 있습니다.
						</div>
						<div class="wr-chat-examples">
							{EXAMPLE_QUESTIONS.map((q) => (
								<button
									key={q}
									class="wr-chat-example-btn"
									onClick={() => props.onSend(q)}
								>
									{q}
								</button>
							))}
						</div>
					</div>
				) : null}
				{turns.map((t, ti) => {
					const isLatest = ti === turns.length - 1;
					const expanded =
						isLatest || props.expandedTurns.has(t.qIdx);
					if (!expanded) {
						return (
							<button
								key={t.qIdx}
								class="wr-chat-turn-collapsed"
								onClick={() => props.onToggleTurn(t.qIdx)}
								title="클릭하여 이 문답 펼치기"
							>
								<b>Q</b>
								<span class="wr-chat-collapsed-text">
									{t.question.content}
								</span>
								<span class="wr-chat-collapsed-chevron">▸</span>
							</button>
						);
					}
					return (
						<div
							key={t.qIdx}
							class={`wr-chat-turn${isLatest ? " is-latest" : ""}`}
							ref={isLatest ? latestTurnRef : undefined}
						>
							<div
								class={`wr-chat-q${isLatest ? "" : " is-collapsible"}`}
								onClick={
									isLatest
										? undefined
										: () => props.onToggleTurn(t.qIdx)
								}
								title={isLatest ? undefined : "클릭하여 접기"}
							>
								<b>Q</b>
								<span>{t.question.content}</span>
							</div>
							{t.answer ? (
								<AnswerBlock
									message={t.answer}
									app={props.app}
									component={props.component}
									onExpandAnswer={props.onExpandAnswer}
									onOpenSource={props.onOpenSource}
									onOpenSourcePopup={props.onOpenSourcePopup}
								/>
							) : null}
						</div>
					);
				})}
				{props.loading ? (
					<div class="wr-chat-loading">
						<span class="wr-chat-spinner" />
						{props.loadingText ?? "답변 생성 중"}
						<span class="wr-chat-dots" />
					</div>
				) : null}
				{props.error ? (
					<div class="wr-chat-error">⚠️ {props.error}</div>
				) : null}
			</div>
			<ChatInput loading={props.loading} onSend={props.onSend} />
		</div>
	);
}

function AnswerBlock(props: {
	message: ChatMessage;
	app: App;
	component: Component;
	onExpandAnswer: (message: ChatMessage) => void;
	onOpenSource: (hit: HybridHit) => void;
	onOpenSourcePopup: (hit: HybridHit) => void;
}) {
	const { message } = props;
	const sources = message.sources ?? [];
	const [sourcesOpen, setSourcesOpen] = useState(false);

	const copyAnswer = () => {
		void navigator.clipboard.writeText(message.content).then(() => {
			new Notice("답변이 클립보드에 복사되었습니다");
		});
	};

	return (
		<div class="wr-chat-answer">
			<MarkdownBody
				text={message.content}
				app={props.app}
				component={props.component}
				citeMax={sources.length}
				onCite={(n) => {
					const h = sources[n - 1];
					if (h) props.onOpenSourcePopup(h);
				}}
			/>
			<div class="wr-chat-answer-footer">
				{sources.length > 0 ? (
					<button
						class={`wr-chat-sources-toggle${sourcesOpen ? " is-open" : ""}`}
						onClick={() => setSourcesOpen(!sourcesOpen)}
					>
						<span class="wr-chat-sources-chevron">
							{sourcesOpen ? "▾" : "▸"}
						</span>
						참고한 노트 {sources.length}개
					</button>
				) : (
					<span />
				)}
				<div class="wr-chat-answer-actions">
					<button
						class="wr-chat-action-btn"
						onClick={() => props.onExpandAnswer(message)}
						title="답변을 넓은 팝업 창에서 읽기"
					>
						🔍 크게 보기
					</button>
					<button
						class="wr-chat-action-btn"
						onClick={copyAnswer}
						title="답변 전체를 클립보드에 복사"
					>
						복사
					</button>
				</div>
			</div>
			{sourcesOpen && sources.length > 0 ? (
				<div class="wr-chat-sources">
					{sources.map((h, i) => (
						<SourceCard
							key={h.chunkId}
							hit={h}
							num={i + 1}
							onOpenPopup={() => props.onOpenSourcePopup(h)}
							onOpenNote={() => props.onOpenSource(h)}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

function SourceCard(props: {
	hit: HybridHit;
	num: number;
	onOpenPopup: () => void;
	onOpenNote: () => void;
}) {
	const { hit, num } = props;
	const group = hit.categoryId === "external" ? "external" : "internal";
	return (
		<div
			class={`wr-chat-source-card wr-chat-source-${group}`}
			onClick={props.onOpenPopup}
			title={`${hit.notePath}\n클릭: 팝업으로 미리보기`}
		>
			<span class="wr-chat-source-num">{num}</span>
			<div class="wr-chat-source-body">
				<div class="wr-chat-source-title">{hit.noteTitle}</div>
				{hit.heading ? (
					<div class="wr-chat-source-heading">{hit.heading}</div>
				) : null}
			</div>
			<button
				class="wr-chat-source-open"
				title="노트 열기"
				onClick={(e) => {
					e.stopPropagation();
					props.onOpenNote();
				}}
			>
				↗
			</button>
		</div>
	);
}

/**
 * 렌더된 마크다운에서 [1]·[2] 인용 표기를 클릭 가능한 배지로 바꾼다.
 * 코드 블록 내부는 건드리지 않는다. (AnswerPopupModal에서도 재사용)
 */
export function linkifyCitations(
	root: HTMLElement,
	citeMax: number,
	onCite: (n: number) => void,
): void {
	if (citeMax <= 0) return;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const targets: Text[] = [];
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const t = node as Text;
		if (!/\[\d/.test(t.nodeValue ?? "")) continue;
		if (t.parentElement?.closest("code, pre")) continue;
		targets.push(t);
	}
	for (const t of targets) {
		const text = t.nodeValue ?? "";
		const frag = document.createDocumentFragment();
		// [1] 단일뿐 아니라 [1, 2]·[1-3] 같은 묶음 표기도 인식.
		const re = /\[([0-9][0-9,，·~\-\s]*)\]/g;
		let last = 0;
		let m: RegExpExecArray | null;
		let changed = false;
		while ((m = re.exec(text)) !== null) {
			const nums = parseCiteNumbers(m[1], citeMax);
			if (!nums || nums.length === 0) continue;
			frag.appendChild(
				document.createTextNode(text.slice(last, m.index)),
			);
			for (const n of nums) {
				const btn = document.createElement("button");
				btn.className = "wr-chat-cite";
				btn.textContent = String(n);
				btn.setAttr("title", "근거 노트 보기");
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					onCite(n);
				});
				frag.appendChild(btn);
			}
			last = m.index + m[0].length;
			changed = true;
		}
		if (!changed) continue;
		frag.appendChild(document.createTextNode(text.slice(last)));
		t.replaceWith(frag);
	}
}

function MarkdownBody(props: {
	text: string;
	app: App;
	component: Component;
	citeMax: number;
	onCite: (n: number) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		let cancelled = false;
		const temp = document.createElement("div");
		void MarkdownRenderer.render(props.app, props.text, temp, "", props.component)
			.then(() => {
				if (cancelled) return;
				linkifyCitations(temp, props.citeMax, props.onCite);
				el.empty();
				while (temp.firstChild) el.appendChild(temp.firstChild);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			el.empty();
		};
	}, [props.text]);
	return <div class="wr-chat-md" ref={ref} />;
}

function ChatInput(props: {
	loading: boolean;
	onSend: (text: string) => void;
}) {
	const [draft, setDraft] = useState("");
	const taRef = useRef<HTMLTextAreaElement>(null);

	const submit = () => {
		const text = draft.trim();
		if (!text || props.loading) return;
		props.onSend(text);
		setDraft("");
		const ta = taRef.current;
		if (ta) ta.style.height = "auto";
	};

	return (
		<div class="wr-chat-input-row">
			<textarea
				ref={taRef}
				class="wr-chat-input"
				placeholder="노트에 대해 질문하세요… (Enter 전송, Shift+Enter 줄바꿈)"
				rows={1}
				value={draft}
				disabled={props.loading}
				onInput={(e) => {
					const ta = e.currentTarget;
					setDraft(ta.value);
					ta.style.height = "auto";
					ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
				}}
				onKeyDown={(e) => {
					// 한글 IME 조합 중 Enter는 전송하지 않는다.
					if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
						e.preventDefault();
						submit();
					}
				}}
			/>
			<button
				class="wr-chat-send-btn"
				disabled={props.loading || draft.trim().length === 0}
				onClick={submit}
				title="질문 보내기"
			>
				↑
			</button>
		</div>
	);
}
