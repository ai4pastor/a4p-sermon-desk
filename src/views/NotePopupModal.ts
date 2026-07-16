// 팝업 보기: 검색 결과 노트 전체를 모달로 렌더하고 해당 청크 위치로 스크롤한다.

import {
	App,
	Component,
	MarkdownRenderer,
	Modal,
	TFile,
} from "obsidian";
import type { HybridHit } from "../search/hybrid";

export interface PopupHost {
	app: App;
	openHit(hit: HybridHit, pane: "split" | "tab"): Promise<void>;
	insertLink(hit: HybridHit): void;
}

/** 공백을 압축하고 NFC로 정규화한다 (앵커 매칭용). */
function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim().normalize("NFC");
}

/** 마크다운 토큰을 걷어내 렌더된 텍스트와 비교 가능한 스니펫을 만든다. */
function normalizeSnippet(text: string): string {
	return normalizeText(
		text
			.replace(/^#{1,6}\s+/gm, "")
			.replace(/[*_`~]/g, "")
			.replace(/^>\s*/gm, "")
			.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, p1, p2) => p2 || p1)
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"),
	);
}

export class NotePopupModal extends Modal {
	private host: PopupHost;
	private hit: HybridHit;
	private closed = false;
	/** MarkdownRenderer가 요구하는 수명 관리용 Component (Modal은 Component가 아님) */
	private renderComponent = new Component();

	constructor(host: PopupHost, hit: HybridHit) {
		super(host.app);
		this.host = host;
		this.hit = hit;
	}

	onOpen(): void {
		this.renderComponent.load();
		this.modalEl.addClass("wr-popup");
		const { contentEl } = this;
		contentEl.empty();

		// 헤더: 제목 + 경로 + (있으면) heading 칩
		const header = contentEl.createDiv({ cls: "wr-popup-header" });
		const titleRow = header.createDiv({ cls: "wr-popup-title-row" });
		titleRow.createSpan({
			cls: "wr-popup-title",
			text: this.hit.noteTitle,
		});
		if (this.hit.heading) {
			titleRow.createSpan({
				cls: "wr-popup-chip",
				text: this.hit.heading,
			});
		}
		header.createDiv({ cls: "wr-popup-path", text: this.hit.notePath });

		// 액션 바
		const actions = contentEl.createDiv({ cls: "wr-popup-actions" });
		const openBtn = actions.createEl("button", {
			cls: "wr-open-btn",
			text: "노트 열기 →",
		});
		openBtn.addEventListener("click", () => {
			this.close();
			void this.host.openHit(this.hit, "split");
		});
		const tabBtn = actions.createEl("button", { text: "새 탭으로 열기" });
		tabBtn.addEventListener("click", () => {
			this.close();
			void this.host.openHit(this.hit, "tab");
		});
		const linkBtn = actions.createEl("button", { text: "🔗 링크 삽입" });
		linkBtn.addEventListener("click", () => {
			this.host.insertLink(this.hit);
		});

		// 본문
		const body = contentEl.createDiv({ cls: "wr-popup-body wr-md" });
		body.setText("불러오는 중…");

		void this.renderBody(body);
	}

	onClose(): void {
		this.closed = true;
		this.renderComponent.unload();
		this.contentEl.empty();
	}

	private async renderBody(body: HTMLElement): Promise<void> {
		const file = this.host.app.vault.getAbstractFileByPath(
			this.hit.notePath,
		);
		if (!(file instanceof TFile)) {
			body.setText("노트를 찾을 수 없습니다.");
			return;
		}
		let content: string;
		try {
			content = await this.host.app.vault.cachedRead(file);
		} catch {
			body.setText("노트를 읽지 못했습니다.");
			return;
		}
		if (this.closed) return;

		const temp = document.createElement("div");
		try {
			await MarkdownRenderer.render(
				this.host.app,
				content,
				temp,
				this.hit.notePath,
				this.renderComponent,
			);
		} catch {
			body.setText("본문을 표시하지 못했습니다.");
			return;
		}
		if (this.closed) return;

		body.empty();
		while (temp.firstChild) body.appendChild(temp.firstChild);

		const anchor = this.findAnchor(body);
		if (anchor) {
			anchor.addClass("wr-popup-anchor");
			// 레이아웃이 잡힌 뒤 스크롤해야 정확히 가운데에 온다.
			window.setTimeout(() => {
				if (this.closed) return;
				anchor.scrollIntoView({ block: "center" });
				anchor.removeClass("wr-flash");
				// reflow로 애니메이션 재시작
				void anchor.offsetWidth;
				anchor.addClass("wr-flash");
			}, 50);
		}
	}

	/** 이 hit이 가리키는 청크 위치의 요소를 찾는다. heading 우선, 다음 본문 스니펫. */
	private findAnchor(body: HTMLElement): HTMLElement | null {
		if (this.hit.heading) {
			const target = normalizeText(this.hit.heading);
			const headings = body.querySelectorAll<HTMLElement>(
				"h1, h2, h3, h4, h5, h6",
			);
			for (const el of Array.from(headings)) {
				if (normalizeText(el.textContent ?? "") === target) {
					return el;
				}
			}
		}
		const source = this.hit.fullText || this.hit.preview;
		const snippet = normalizeSnippet(source).slice(0, 40);
		if (snippet.length < 8) return null;
		const blocks = body.querySelectorAll<HTMLElement>(
			"p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td",
		);
		for (const el of Array.from(blocks)) {
			if (normalizeText(el.textContent ?? "").includes(snippet)) {
				return el;
			}
		}
		return null;
	}
}
