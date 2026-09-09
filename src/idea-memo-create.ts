// 선택 텍스트 → 아이디어 메모 노트 생성(+ 선택적 Templater 템플릿 실행)의 Obsidian 측 오케스트레이터.
// 제목·경로·본문 조립은 순수 모듈 idea-memo.ts가 담당한다. 원본 노트는 건드리지 않는다.

import {
	type App,
	type Editor,
	MarkdownView,
	Notice,
	TFile,
	TFolder,
	normalizePath,
} from "obsidian";
import type WeightedRecallPlugin from "./main";
import { composeIdeaMemo, deriveIdeaTitle, uniqueIdeaPath } from "./idea-memo";
import { normalizeIdeaCallout } from "./settings";

/** Templater 내부 API 중 쓰는 부분만 — 단축키 "템플릿 삽입"이 호출하는 메서드와 같다. */
interface TemplaterApi {
	append_template_to_active_file(templateFile: TFile): Promise<void>;
}

interface TemplaterPluginLike {
	templater?: unknown;
	settings?: { templates_folder?: unknown };
}

function templaterPlugin(app: App): TemplaterPluginLike | undefined {
	const plugins = (
		app as unknown as { plugins?: { plugins?: Record<string, unknown> } }
	).plugins?.plugins;
	return plugins?.["templater-obsidian"] as TemplaterPluginLike | undefined;
}

function getTemplater(app: App): TemplaterApi | null {
	const tp = templaterPlugin(app)?.templater as Partial<TemplaterApi> | undefined;
	return typeof tp?.append_template_to_active_file === "function"
		? (tp as TemplaterApi)
		: null;
}

/** Templater가 켜져 있고 템플릿 삽입 API를 쓸 수 있는지(설정 탭 검증용). */
export function hasTemplater(app: App): boolean {
	return getTemplater(app) !== null;
}

/** Templater 설정의 템플릿 폴더 — 템플릿 자동완성 우선 정렬용. 없으면 "". */
export function templaterTemplatesFolder(app: App): string {
	const folder = templaterPlugin(app)?.settings?.templates_folder;
	return typeof folder === "string" ? folder : "";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** openFile 직후 새 노트가 활성 에디터가 될 때까지 잠깐 기다린다(레이스 방지). */
async function waitForActiveEditor(
	app: App,
	file: TFile,
	tries = 10,
	delayMs = 50,
): Promise<MarkdownView | null> {
	for (let i = 0; i < tries; i++) {
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		const ae = app.workspace.activeEditor;
		if (
			view?.file?.path === file.path &&
			ae?.file?.path === file.path &&
			ae.editor
		) {
			return view;
		}
		await sleep(delayMs);
	}
	return null;
}

/**
 * 선택 텍스트로 아이디어 메모를 만든다: 지정 폴더에 새 노트(frontmatter + 인용 콜아웃 + 원본 링크)
 * → 새 탭(소스 모드)에서 열기 → 설정된 템플릿이 있으면 Templater로 실행.
 * 폴더가 없으면 만들지 않고 안내만 한다(플러그인은 메모 노트 외 아무것도 만들지 않는다).
 */
export async function createIdeaMemo(
	plugin: WeightedRecallPlugin,
	editor: Editor,
	sourceFile: TFile | null,
): Promise<void> {
	const { app, settings } = plugin;
	const selection = editor.getSelection();
	if (!selection.trim()) {
		new Notice("A4P Sermon Desk: 아이디어 메모로 만들 텍스트를 먼저 선택하세요");
		return;
	}
	const folderSetting = settings.ideaMemoFolder.trim();
	if (!folderSetting) {
		new Notice(
			"A4P Sermon Desk: 아이디어 메모 폴더가 설정되지 않았습니다 — 설정 › 💡 아이디어 메모",
		);
		return;
	}
	const folderPath = normalizePath(folderSetting);
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) {
		new Notice(
			`A4P Sermon Desk: 아이디어 메모 폴더를 찾을 수 없습니다: ${folderPath} — 옵시디언에서 먼저 만들어 주세요`,
		);
		return;
	}

	const now = new Date();
	const title = deriveIdeaTitle(selection, now);
	const path = uniqueIdeaPath(
		folder.path,
		title,
		(p) => app.vault.getAbstractFileByPath(p) !== null,
	);

	let sourceLink = "";
	if (sourceFile) {
		try {
			sourceLink = app.fileManager.generateMarkdownLink(sourceFile, path);
		} catch {
			sourceLink = `[[${sourceFile.basename}]]`;
		}
	} else {
		new Notice("A4P Sermon Desk: 원본을 알 수 없어 출처 링크 없이 생성합니다");
	}

	let file: TFile;
	try {
		file = await app.vault.create(
			path,
			composeIdeaMemo({
				selection,
				sourceLink,
				calloutType: normalizeIdeaCallout(settings.ideaMemoCallout),
				now,
			}),
		);
	} catch (e) {
		console.error("[a4p-sermon-desk] idea memo create failed", e);
		new Notice(
			`A4P Sermon Desk: 아이디어 메모 생성 실패 — ${(e as Error).message}`,
		);
		return;
	}

	// 새 탭 + 소스 모드: 새 탭 기본 보기가 읽기 모드면 Templater가 에디터를 찾지 못한다.
	const leaf = app.workspace.getLeaf("tab");
	await leaf.openFile(file, { active: true, state: { mode: "source" } });
	new Notice(`A4P Sermon Desk: 아이디어 메모 생성 — ${file.basename}`);

	const templatePath = settings.ideaMemoTemplate.trim();
	if (!templatePath) return;
	const templater = getTemplater(app);
	if (!templater) {
		new Notice("A4P Sermon Desk: Templater 플러그인이 없어 템플릿을 건너뜁니다");
		return;
	}
	const template = app.vault.getAbstractFileByPath(normalizePath(templatePath));
	if (!(template instanceof TFile)) {
		new Notice(
			`A4P Sermon Desk: 템플릿 파일을 찾을 수 없어 건너뜁니다: ${templatePath}`,
		);
		return;
	}
	const view = await waitForActiveEditor(app, file);
	if (!view) {
		new Notice(
			"A4P Sermon Desk: 에디터가 준비되지 않아 템플릿을 건너뜁니다 — 메모에서 템플릿 단축키를 직접 누르세요",
		);
		return;
	}
	// 커서를 본문 끝(콜아웃 아래 빈 줄)에 두어 템플릿 출력이 콜아웃을 쪼개지 않게 한다.
	const ed = view.editor;
	const last = ed.lastLine();
	ed.setCursor({ line: last, ch: ed.getLine(last).length });
	try {
		await templater.append_template_to_active_file(template);
	} catch (e) {
		console.error("[a4p-sermon-desk] idea memo template failed", e);
		new Notice(
			`A4P Sermon Desk: 템플릿 실행 실패 — ${(e as Error).message}`,
		);
	}
}
