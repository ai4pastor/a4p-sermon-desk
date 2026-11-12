// 지연 로드(0.12.4) — 플러그인 본체를 가짜 옵시디언 위에서 실제 sql.js·실제 파일로 돌린다.
// onload는 index.db를 읽지 않고 끝나고(옵시디언 "taking long to load" 경고 방지), 레이아웃
// 준비 뒤나 첫 사용 때 불러온다. 불러오는 동안 들어온 삭제는 대기열을 거쳐 반영된다.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as nodeSqlite from "node:sqlite";

const h = vi.hoisted(() => {
	(globalThis as Record<string, unknown>).__DEV__ = false;
	return { notices: [] as string[] };
});

vi.mock("obsidian", () => {
	class TAbstractFile {
		path = "";
	}
	class TFile extends TAbstractFile {
		extension = "md";
	}
	class TFolder extends TAbstractFile {}
	class Plugin {
		constructor(
			public app: unknown,
			public manifest: unknown,
		) {}
		addSettingTab() {}
		registerView() {}
		registerHoverLinkSource() {}
		addCommand() {}
		addRibbonIcon() {}
		registerEvent() {}
		async loadData() {
			return null;
		}
		async saveData() {}
	}
	class Notice {
		constructor(message: string) {
			h.notices.push(message);
		}
		setMessage() {
			return this;
		}
		hide() {}
	}
	return {
		normalizePath: (p: string) => p.replace(/\/+/g, "/"),
		Notice,
		Plugin,
		TAbstractFile,
		TFile,
		TFolder,
	};
});
vi.mock("../src/db/sqljs-loader", async () => {
	const { default: initSqlJs } = await import("sql.js");
	const nodePath = await import("node:path");
	let sql: ReturnType<typeof initSqlJs> | null = null;
	return {
		loadSqlJs: () =>
			(sql ??= initSqlJs({
				locateFile: (f: string) =>
					nodePath.resolve(process.cwd(), "node_modules/sql.js/dist", f),
			})),
	};
});
// 화면·형태소(wasm)·색인기는 이 테스트 범위 밖
vi.mock("../src/settings-tab", () => ({
	WeightedRecallSettingTab: class {
		refreshIfShown() {}
	},
}));
vi.mock("../src/views/RecallView", () => ({
	RecallView: class {},
	RECALL_VIEW_TYPE: "a4p-test-view",
	MIN_PARAGRAPH_CHARS: 10,
	MIN_SELECTION_CHARS: 2,
}));
vi.mock("../src/idea-memo-create", () => ({ createIdeaMemo: async () => {} }));
vi.mock("../src/indexer/indexer", () => ({
	runIndex: async () => ({}),
	retokenizeAllChunks: async () => ({}),
}));
vi.mock("../src/morpheme", () => ({
	tokenize: async () => [],
	tokenizeKorean: async () => [],
	preloadMorpheme: async () => {},
	destroyMorpheme: () => {},
	benchMorpheme: async () => ({}),
	setProtectedTerms: () => {},
}));

import { TFile } from "obsidian";
import type { Database } from "sql.js";
import WeightedRecallPlugin from "../src/main";
import { setNativeSqliteForTests, type NativeSqlite } from "../src/db/compact";
import { loadSqlJs } from "../src/db/sqljs-loader";
import { makeMiniDb } from "./helpers/mini-db";
import { makeFsAdapter, makeTempVault } from "./helpers/fs-adapter";

const DIR = ".obsidian/plugins/a4p-sermon-desk";

beforeAll(async () => {
	// sql.js는 window가 없을 때 초기화해야 노드 경로로 wasm을 찾는다 — 전역 대역보다 먼저
	await loadSqlJs();
	(await makeMiniDb()).close();
	vi.stubGlobal("window", {
		setTimeout: globalThis.setTimeout,
		clearTimeout: globalThis.clearTimeout,
	});
	vi.stubGlobal("document", {
		createElement: () => ({ remove() {} }),
		head: { appendChild() {} },
	});
	setNativeSqliteForTests(nodeSqlite as unknown as NativeSqlite);
});
afterAll(() => {
	vi.unstubAllGlobals();
	setNativeSqliteForTests(undefined);
});

/** 노트들이 색인된 index.db를 가진 임시 볼트. */
async function seedVault(paths: string[]): Promise<string> {
	const base = makeTempVault(DIR);
	const mini = await makeMiniDb();
	for (const p of paths) {
		mini.addNote(p);
		mini.addChunk(p, { text: "본문 ".repeat(300), terms: ["본문"] });
	}
	fs.writeFileSync(path.join(base, DIR, "index.db"), mini.db.export());
	mini.close();
	return base;
}

function makePlugin(base: string) {
	let layoutReady: (() => void) | null = null;
	const app = {
		vault: {
			adapter: makeFsAdapter(base),
			on: () => ({}),
			getMarkdownFiles: () => [],
			getAbstractFileByPath: () => null,
		},
		workspace: {
			onLayoutReady: (cb: () => void) => {
				layoutReady = cb;
			},
			on: () => ({}),
			getLeavesOfType: () => [],
		},
	};
	const plugin = new WeightedRecallPlugin(
		app as never,
		{ id: "a4p-sermon-desk", dir: DIR } as never,
	);
	const vaultDelete = (p: string) =>
		(plugin as unknown as { onVaultDelete(f: unknown): void }).onVaultDelete(
			Object.assign(new TFile(), { path: p }),
		);
	return { plugin, fireLayoutReady: () => layoutReady?.(), vaultDelete };
}

function notePaths(db: Database): string[] {
	return (
		db.exec("SELECT path FROM notes ORDER BY path")[0]?.values.map((r) =>
			String(r[0]),
		) ?? []
	);
}

describe("index.db 지연 로드", () => {
	it("onload은 색인을 읽지 않고 끝나고, 레이아웃이 준비되면 불러온다", async () => {
		const { plugin, fireLayoutReady } = makePlugin(await seedVault(["a.md", "b.md"]));
		await plugin.onload();
		expect(plugin.db).toBeNull();
		expect(plugin.dbStatus).toBe("loading");

		fireLayoutReady();
		const db = await plugin.whenDbReady();

		expect(plugin.dbStatus).toBe("ready");
		expect(notePaths(db!)).toEqual(["a.md", "b.md"]);
		await plugin.onunload();
	});

	it("불러오는 동안 들어온 노트 삭제는 대기열에 쌓였다가 불러온 뒤 반영된다", async () => {
		const { plugin, fireLayoutReady, vaultDelete } = makePlugin(
			await seedVault(["a.md", "b.md"]),
		);
		await plugin.onload();
		vaultDelete("a.md");
		expect(plugin.db).toBeNull();

		fireLayoutReady();
		const db = await plugin.whenDbReady();

		expect(notePaths(db!)).toEqual(["b.md"]);
		await plugin.onunload();
	});

	it("불러오기 전에 누른 작업은 기다렸다가 실행된다('DB가 로드되지 않았습니다' 없음)", async () => {
		const { plugin } = makePlugin(await seedVault(["a.md"]));
		await plugin.onload();
		h.notices.length = 0;

		await plugin.runReapply(); // 레이아웃 준비 전 — 첫 사용이 불러오기를 시작한다

		expect(plugin.dbStatus).toBe("ready");
		expect(h.notices.some((n) => n.includes("로드되지 않았습니다"))).toBe(false);
		expect(h.notices.some((n) => n.includes("폴더 설정 재적용"))).toBe(true);
		await plugin.onunload();
	});

	it("불러오는 도중 플러그인이 꺼지면 DB를 붙이지 않고 닫는다", async () => {
		const { plugin, fireLayoutReady } = makePlugin(await seedVault(["a.md"]));
		await plugin.onload();
		fireLayoutReady();
		await plugin.onunload();

		expect(await plugin.whenDbReady()).toBeNull();
	});
});

describe("[색인 압축]", () => {
	it("파일이 줄고, 메모리 DB도 압축 파일로 바뀌며 내용은 같다", async () => {
		const paths = Array.from({ length: 120 }, (_, i) => `n${i}.md`);
		const base = await seedVault(paths);
		const { plugin, fireLayoutReady, vaultDelete } = makePlugin(base);
		await plugin.onload();
		fireLayoutReady();
		const before = (await plugin.whenDbReady())!;
		// 범위 축소 흉내 — 행만 지워지고 파일 크기는 그대로
		for (const p of paths.slice(20)) vaultDelete(p);
		h.notices.length = 0;

		await plugin.runCompact();

		const after = plugin.db!;
		expect(after).not.toBe(before);
		expect(notePaths(after)).toEqual(paths.slice(0, 20).sort());
		const size = (name: string) => fs.statSync(path.join(base, DIR, name)).size;
		expect(size("index.db")).toBeLessThan(size("index.db.bak"));
		expect(h.notices.some((n) => n.includes("색인 압축 완료"))).toBe(true);
		await plugin.onunload();
	});
});
