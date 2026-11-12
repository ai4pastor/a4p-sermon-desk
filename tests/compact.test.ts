// 색인 압축(0.12.4) — 실제 sql.js·실제 파일·실제 내장 SQLite(node:sqlite)로 검증한다.
// 보장: ① 내용·행 수는 그대로, 파일만 줄어든다 ② 직전 파일은 .bak로 남는다
// ③ 검사에 실패하면 index.db를 바꾸지 않고 임시 파일도 남기지 않는다.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as nodeSqlite from "node:sqlite";

vi.mock("obsidian", () => ({
	normalizePath: (p: string) => p.replace(/\/+/g, "/"),
	Notice: class {},
	Plugin: class {},
}));
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

import type { Plugin } from "obsidian";
import type { Database } from "sql.js";
import {
	compactDbFile,
	isCompactAvailable,
	setNativeSqliteForTests,
	type NativeSqlite,
} from "../src/db/compact";
import { compactDb, openDbFile } from "../src/db/persistence";
import { deleteNoteRows } from "../src/indexer/note-rows";
import { makeMiniDb } from "./helpers/mini-db";
import { makeFsAdapter, makeTempVault } from "./helpers/fs-adapter";

const DIR = ".obsidian/plugins/a4p-sermon-desk";
const realSqlite = nodeSqlite as unknown as NativeSqlite;

/** 노트 total개를 색인한 뒤 keep개만 남기고 지운 메모리 DB — 범위를 줄인 상황 흉내. */
async function shrunkDb(total: number, keep: number): Promise<Database> {
	const mini = await makeMiniDb();
	const paths: string[] = [];
	for (let i = 0; i < total; i++) {
		const p = `노트/${i}.md`;
		paths.push(p);
		mini.addNote(p);
		mini.addChunk(p, {
			text: "은혜와 믿음 ".repeat(200),
			terms: ["은혜", "믿음", "은혜"],
			vec: Array.from({ length: 256 }, (_, k) => ((i + k) % 7) / 7),
		});
		mini.addTag(p, "설교");
	}
	deleteNoteRows(mini.db, paths.slice(keep));
	return mini.db;
}

function counts(db: Database): string {
	return ["notes", "chunks", "embeddings", "chunk_terms", "note_tags"]
		.map((t) => `${t}=${db.exec(`SELECT COUNT(*) FROM ${t}`)[0].values[0][0]}`)
		.join(" ");
}

function setup() {
	const base = makeTempVault(DIR);
	const plugin = {
		app: { vault: { adapter: makeFsAdapter(base) } },
		manifest: { dir: DIR },
	} as unknown as Plugin;
	const file = (name: string) => path.join(base, DIR, name);
	const tmpFiles = () =>
		fs.readdirSync(path.join(base, DIR)).filter((f) => f.startsWith("index.db.tmp"));
	return { plugin, file, tmpFiles };
}

/** 압축 사본(index.db.tmp-*)의 quick_check만 실패로 꾸민 내장 SQLite. */
function sqliteFailingCheck(): NativeSqlite {
	return {
		DatabaseSync: class {
			private db: InstanceType<NativeSqlite["DatabaseSync"]>;
			private isCopy: boolean;
			constructor(p: string, o?: { readOnly?: boolean }) {
				this.db = new realSqlite.DatabaseSync(p, o);
				this.isCopy = p.includes("index.db.tmp");
			}
			exec(sql: string) {
				this.db.exec(sql);
			}
			prepare(sql: string) {
				if (this.isCopy && sql.startsWith("PRAGMA quick_check")) {
					return { get: () => ({ quick_check: "*** in database main ***" }) };
				}
				return this.db.prepare(sql);
			}
			close() {
				this.db.close();
			}
		},
	};
}

beforeAll(() => setNativeSqliteForTests(realSqlite));
afterEach(() => setNativeSqliteForTests(realSqlite));

describe("compactDbFile", () => {
	it("원본은 읽기만 하고, 행 수가 같은 더 작은 사본을 만든다", async () => {
		const { file } = setup();
		const db = await shrunkDb(120, 20);
		fs.writeFileSync(file("index.db"), db.export());
		const original = fs.readFileSync(file("index.db"));

		compactDbFile(file("index.db"), file("compact.db"));

		expect(fs.readFileSync(file("index.db")).equals(original)).toBe(true);
		expect(fs.statSync(file("compact.db")).size).toBeLessThan(original.length);
		const copy = new realSqlite.DatabaseSync(file("compact.db"), { readOnly: true });
		expect(copy.prepare("SELECT COUNT(*) AS n FROM chunks").get()?.n).toBe(20);
		copy.close();
	});

	it("내장 SQLite가 없는 옵시디언이면 쓸 수 없다고 알린다", () => {
		setNativeSqliteForTests(null);
		expect(isCompactAvailable()).toBe(false);
		expect(() => compactDbFile("a", "b")).toThrow("쓸 수 없습니다");
	});
});

describe("compactDb", () => {
	it("index.db가 줄고, 직전 파일은 .bak로 남으며, 다시 열면 내용이 같다", async () => {
		const { plugin, file, tmpFiles } = setup();
		const db = await shrunkDb(120, 20);
		fs.writeFileSync(file("index.db"), db.export());

		const r = await compactDb(plugin, db);

		expect(r.after).toBeLessThan(r.before);
		expect(fs.statSync(file("index.db")).size).toBe(r.after);
		expect(fs.statSync(file("index.db.bak")).size).toBe(r.before);
		expect(tmpFiles()).toEqual([]);
		const reopened = await openDbFile(plugin);
		expect(counts(reopened)).toBe(counts(db));
	});

	it("압축 사본이 검사를 통과하지 못하면 index.db를 바꾸지 않고 임시 파일도 지운다", async () => {
		const { plugin, file, tmpFiles } = setup();
		const db = await shrunkDb(120, 20);
		setNativeSqliteForTests(sqliteFailingCheck());

		await expect(compactDb(plugin, db)).rejects.toThrow("검사 실패");

		// 압축 전에 저장한 메모리 상태 그대로(빈 공간 포함)
		expect(fs.readFileSync(file("index.db")).equals(Buffer.from(db.export()))).toBe(true);
		expect(tmpFiles()).toEqual([]);
	});
});
