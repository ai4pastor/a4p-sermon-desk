// reapplyFolderSettings — 0→N 부활·폴더 추가 시 지문을 기록하지 않는지(배너 유지).
import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class {},
	normalizePath: (p: string) => p.replace(/\/+/g, "/"),
}));

import {
	reapplyFolderSettings,
	countUnindexed,
} from "../src/indexer/scanner";
import {
	DEFAULT_SETTINGS,
	normalizeSettings,
	foldersFingerprint,
} from "../src/settings";
import { getMeta, FOLDERS_FP_KEY } from "../src/db/meta";
import { makeMiniDb } from "./helpers/mini-db";

function settingsFor(folders: { path: string; weight: number }[]) {
	return normalizeSettings({
		...DEFAULT_SETTINGS,
		folders: folders.map((f) => ({ ...f, groupId: "internal" as const })),
		profiles: [],
		excludedFolders: [],
	});
}

describe("countUnindexed", () => {
	it("범위 경로 중 notes에 없는 수를 센다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("on/a.md");
			expect(countUnindexed(m.db, ["on/a.md", "on/b.md", "new/c.md"])).toBe(2);
			expect(countUnindexed(m.db, [])).toBe(0);
		} finally {
			m.close();
		}
	});
});

describe("reapplyFolderSettings — 지문 기록 조건", () => {
	it("범위 노트가 전부 색인돼 있으면 가중치를 갱신하고 지문을 기록한다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("on/a.md", { weight: 1.5 });
			m.addNote("old/b.md", { weight: 1.5 });
			const s = settingsFor([{ path: "on/", weight: 5 }]);
			const r = reapplyFolderSettings(m.db, s, ["on/a.md"]);
			expect(r).toEqual({ updated: 2, missing: 0 });
			expect(getMeta(m.db, FOLDERS_FP_KEY)).toBe(foldersFingerprint(s));
			const rows = m.db.exec("SELECT path, weight FROM notes ORDER BY path")[0]
				.values;
			// on/ = 5점 → 0.75, old/는 범위 밖 → 0(검색 제외)
			expect(rows).toEqual([
				["old/b.md", 0],
				["on/a.md", 0.75],
			]);
		} finally {
			m.close();
		}
	});

	it("범위에 들어왔지만 색인되지 않은 노트가 있으면 지문을 기록하지 않는다", async () => {
		const m = await makeMiniDb();
		try {
			m.addNote("on/a.md", { weight: 1.5 });
			const s = settingsFor([
				{ path: "on/", weight: 5 },
				{ path: "revived/", weight: 3 },
			]);
			// revived/는 0점이던 폴더를 살린 경우 — 인덱스에 행이 없다.
			const r = reapplyFolderSettings(m.db, s, ["on/a.md", "revived/x.md"]);
			expect(r).toEqual({ updated: 1, missing: 1 });
			expect(getMeta(m.db, FOLDERS_FP_KEY)).toBeNull();
			// 기존 노트의 가중치 갱신은 그대로 수행된다.
			const w = m.db.exec("SELECT weight FROM notes WHERE path='on/a.md'")[0]
				.values[0][0];
			expect(w).toBe(0.75);
		} finally {
			m.close();
		}
	});
});
