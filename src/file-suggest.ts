import { AbstractInputSuggest, App, TFile } from "obsidian";
import { isUnderFolder } from "./settings";

/**
 * 마크다운 파일 경로 자동완성 — FolderSuggest의 파일판. `.md`만 보여 주고,
 * preferFolder(예: Templater 템플릿 폴더) 아래 파일을 먼저 정렬한다.
 */
export class FileSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
		private preferFolder = "",
	) {
		super(app, inputEl);
		// FolderSuggest와 동일 — 빈 칸을 클릭(focus)만 해도 전체 목록이 보이도록 input 이벤트를 한 번 흘려준다.
		inputEl.addEventListener("focus", () => {
			inputEl.dispatchEvent(new Event("input"));
		});
	}

	getSuggestions(query: string): TFile[] {
		const q = query.toLowerCase();
		const prefer = this.preferFolder.replace(/\/+$/, "");
		const rank = (f: TFile) => (isUnderFolder(f.path, prefer) ? 0 : 1);
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => !q || f.path.toLowerCase().includes(q));
		files.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
		return files.slice(0, 100);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.inputEl.value = file.path;
		this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
		this.close();
	}
}
