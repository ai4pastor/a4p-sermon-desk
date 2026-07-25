import { describe, it, expect, vi } from "vitest";
import type { Plugin } from "obsidian";
import type { Database } from "sql.js";

vi.mock("obsidian", () => ({
	normalizePath: (p: string) => p.replace(/\/+/g, "/"),
	Notice: class {},
	Plugin: class {},
}));
vi.mock("../src/db/sqljs-loader", () => ({
	loadSqlJs: async () => ({
		Database: class {
			constructor(_bytes?: Uint8Array) {}
		},
	}),
}));
vi.mock("../src/db/migrate", () => ({ runMigrations: () => {} }));

import { saveDb, loadOrCreateDb } from "../src/db/persistence";

const DIR = ".obsidian/plugins/a4p-sermon-desk";
const DB = `${DIR}/index.db`;
const BAK = `${DIR}/index.db.bak`;

type Files = Map<string, ArrayBuffer>;

function makeAdapter(files: Files, opts?: { failRenameFromTmp?: boolean }) {
	return {
		async exists(p: string) {
			return files.has(p);
		},
		async remove(p: string) {
			if (!files.delete(p)) throw new Error(`ENOENT: remove ${p}`);
		},
		async rename(from: string, to: string) {
			if (opts?.failRenameFromTmp && from.includes("index.db.tmp")) {
				throw new Error(`EIO: rename ${from} -> ${to}`);
			}
			const v = files.get(from);
			if (v === undefined) throw new Error(`ENOENT: rename ${from}`);
			files.delete(from);
			files.set(to, v);
		},
		async writeBinary(p: string, data: ArrayBuffer) {
			files.set(p, data);
		},
		async readBinary(p: string) {
			const v = files.get(p);
			if (v === undefined) throw new Error(`ENOENT: read ${p}`);
			return v;
		},
		async list(dir: string) {
			return {
				files: [...files.keys()].filter((k) =>
					k.startsWith(`${dir}/`),
				),
				folders: [] as string[],
			};
		},
	};
}

function makePlugin(adapter: ReturnType<typeof makeAdapter>): Plugin {
	return {
		app: { vault: { adapter } },
		manifest: { dir: DIR },
	} as unknown as Plugin;
}

function fakeDb(byte: number): Database {
	return { export: () => new Uint8Array([byte]) } as unknown as Database;
}

function bytesAt(files: Files, path: string): number[] {
	const buf = files.get(path);
	return buf ? [...new Uint8Array(buf)] : [];
}

function tmpFiles(files: Files): string[] {
	return [...files.keys()].filter((k) => k.includes("index.db.tmp"));
}

describe("saveDb", () => {
	it("저장 성공 시 index.db를 교체하고 직전 버전을 .bak로 보관한다", async () => {
		const files: Files = new Map([[DB, new Uint8Array([1]).buffer]]);
		const plugin = makePlugin(makeAdapter(files));

		await saveDb(plugin, fakeDb(2));

		expect(bytesAt(files, DB)).toEqual([2]);
		expect(bytesAt(files, BAK)).toEqual([1]);
		expect(tmpFiles(files)).toEqual([]);
	});

	it("동시 호출은 직렬화되어 마지막 저장이 index.db가 된다", async () => {
		const files: Files = new Map([[DB, new Uint8Array([1]).buffer]]);
		const plugin = makePlugin(makeAdapter(files));

		await Promise.all([
			saveDb(plugin, fakeDb(2)),
			saveDb(plugin, fakeDb(3)),
		]);

		expect(bytesAt(files, DB)).toEqual([3]);
		expect(bytesAt(files, BAK)).toEqual([2]);
		expect(tmpFiles(files)).toEqual([]);
	});

	it("교체(rename) 실패 시 .bak를 index.db로 즉시 복원한다", async () => {
		const files: Files = new Map([[DB, new Uint8Array([1]).buffer]]);
		const plugin = makePlugin(
			makeAdapter(files, { failRenameFromTmp: true }),
		);

		await expect(saveDb(plugin, fakeDb(2))).rejects.toThrow("EIO");

		expect(bytesAt(files, DB)).toEqual([1]);
		expect(files.has(BAK)).toBe(false);
		expect(tmpFiles(files)).toEqual([]);
	});
});

describe("loadOrCreateDb", () => {
	it("고아 .tmp 파일을 prefix 매칭으로 정리한다 (구버전 고정명 포함)", async () => {
		const files: Files = new Map([
			[DB, new Uint8Array([1]).buffer],
			[`${DIR}/index.db.tmp`, new Uint8Array([9]).buffer],
			[`${DIR}/index.db.tmp-abc`, new Uint8Array([9]).buffer],
		]);
		const plugin = makePlugin(makeAdapter(files));

		await loadOrCreateDb(plugin);

		expect(tmpFiles(files)).toEqual([]);
		expect(files.has(DB)).toBe(true);
	});

	it("index.db가 없고 .bak만 있으면 .bak를 복구한다", async () => {
		const files: Files = new Map([[BAK, new Uint8Array([1]).buffer]]);
		const plugin = makePlugin(makeAdapter(files));

		await loadOrCreateDb(plugin);

		expect(bytesAt(files, DB)).toEqual([1]);
		expect(files.has(BAK)).toBe(false);
	});
});
