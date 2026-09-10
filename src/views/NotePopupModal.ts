// 팝업 보기: 검색 결과 노트 전체를 모달로 렌더하고 해당 청크 위치로 스크롤한다.

import {
	App,
	Component,
	MarkdownRenderer,
	Modal,
	TFile,
} from "obsidian";
import type { HybridHit } from "../search/hybrid";
import type { InsertMode } from "../settings";
import { INSERT_LABEL } from "../insert";
import { stripInlineMarkdown } from "../markdown-text";
import { pickAnchor } from "../anchor";
import { collectBlocks, highlightRendered } from "./highlight-dom";

export interface PopupHost {
	app: App;
	/** 모달을 열 때의 삽입 방식 스냅샷 (버튼 라벨용). */
	insertMode: InsertMode;
	openHit(hit: HybridHit, pane: "split" | "tab"): Promise<void>;
	insertLink(hit: HybridHit, altKey: boolean): void;
}

export class NotePopupModal extends Modal {
	private host: PopupHost;
	private hit: HybridHit;
	/** 하이라이트·앵커 선택에 쓰는 검색어 — 카드 스니펫과 같은 기준(쿼리 토큰 또는 매칭 키). */
	private terms: string[];
	private closed = false;
	/** MarkdownRenderer가 요구하는 수명 관리용 Component (Modal은 Component가 아님) */
	private renderComponent = new Component();

	constructor(host: PopupHost, hit: HybridHit, terms: string[] = []) {
		super(host.app);
		this.host = host;
		this.hit = hit;
		this.terms = terms;
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
				text: stripInlineMarkdown(this.hit.heading),
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
		const linkBtn = actions.createEl("button", {
			text: INSERT_LABEL[this.host.insertMode],
			title: "Option(Alt)+클릭: 반대 방식으로 삽입",
		});
		linkBtn.addEventListener("click", (e) => {
			this.host.insertLink(this.hit, e.altKey);
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

		// 본문 전체에 검색어 <mark> (펼침 카드와 동일) → 블록 수집 → 앵커 선택.
		// 예전엔 청크 첫 줄을 탐침으로 써서 헤딩 없는 노트(=청크 1개)에서 첫 글머리표가
		// 항상 하이라이트됐다. 이제 검색어가 든 블록만 노란 배경, 나머지는 위치 이동만.
		highlightRendered(body, this.terms);
		const blocks = collectBlocks(body);
		const pick = pickAnchor(blocks, {
			terms: this.terms,
			chunkText: this.hit.fullText || this.hit.preview,
			heading: this.hit.heading,
		});
		if (!pick) return;
		const anchor = blocks[pick.index].el;
		if (pick.reason === "terms") anchor.addClass("wr-popup-anchor");
		// 레이아웃이 잡힌 뒤 스크롤해야 정확히 가운데에 온다.
		window.setTimeout(() => {
			if (this.closed) return;
			anchor.scrollIntoView({ block: "center" });
			if (pick.reason === "chunk") return;
			anchor.removeClass("wr-flash");
			// reflow로 애니메이션 재시작
			void anchor.offsetWidth;
			anchor.addClass("wr-flash");
		}, 50);
	}
}
