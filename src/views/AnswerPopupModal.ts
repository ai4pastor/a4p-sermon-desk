// 크게 보기: 채팅 답변을 넓은 모달에서 정독한다. 인용 배지 클릭도 그대로 동작.

import { App, Component, MarkdownRenderer, Modal, Notice } from "obsidian";
import type { HybridHit } from "../search/hybrid";
import type { ChatMessage } from "../chat/rag";
import { linkifyCitations } from "./ChatPanel";

export class AnswerPopupModal extends Modal {
	private question: string;
	private message: ChatMessage;
	private onOpenSourcePopup: (hit: HybridHit) => void;
	private closed = false;
	/** MarkdownRenderer가 요구하는 수명 관리용 Component (Modal은 Component가 아님) */
	private renderComponent = new Component();

	constructor(
		app: App,
		question: string,
		message: ChatMessage,
		onOpenSourcePopup: (hit: HybridHit) => void,
	) {
		super(app);
		this.question = question;
		this.message = message;
		this.onOpenSourcePopup = onOpenSourcePopup;
	}

	onOpen(): void {
		this.renderComponent.load();
		this.modalEl.addClass("wr-popup");
		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createDiv({ cls: "wr-popup-header" });
		const titleRow = header.createDiv({ cls: "wr-popup-title-row" });
		titleRow.createSpan({ cls: "wr-popup-title", text: "💬 답변 크게 보기" });
		header.createDiv({ cls: "wr-popup-path", text: `Q. ${this.question}` });

		const actions = contentEl.createDiv({ cls: "wr-popup-actions" });
		const copyBtn = actions.createEl("button", { text: "복사" });
		copyBtn.addEventListener("click", () => {
			void navigator.clipboard
				.writeText(this.message.content)
				.then(() => new Notice("답변이 클립보드에 복사되었습니다"));
		});

		const body = contentEl.createDiv({
			cls: "wr-popup-body wr-chat-md wr-chat-md-popup",
		});
		body.setText("불러오는 중…");
		void this.renderBody(body);
	}

	onClose(): void {
		this.closed = true;
		this.renderComponent.unload();
		this.contentEl.empty();
	}

	private async renderBody(body: HTMLElement): Promise<void> {
		const sources = this.message.sources ?? [];
		const temp = document.createElement("div");
		try {
			await MarkdownRenderer.render(
				this.app,
				this.message.content,
				temp,
				"",
				this.renderComponent,
			);
		} catch {
			body.setText("본문을 표시하지 못했습니다.");
			return;
		}
		if (this.closed) return;
		linkifyCitations(temp, sources.length, (n) => {
			const h = sources[n - 1];
			if (h) this.onOpenSourcePopup(h);
		});
		body.empty();
		while (temp.firstChild) body.appendChild(temp.firstChild);
	}
}
