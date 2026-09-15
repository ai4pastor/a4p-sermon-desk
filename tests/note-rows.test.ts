// 노트 단위 색인 행 정리(note-rows.ts) — 삭제·폴더 삭제·이름 변경이 6개 테이블을
// 정확히 정리/이동하는지. mini-db는 applySchema → PRAGMA foreign_keys=ON이라
// 이름 변경 순서(새 부모 삽입 → 자식 이동 → 옛 부모 삭제)의 최악 조건이다.
import { describe, it, expect } from "vitest";
import type { Database } from "sql.js";
import { makeMiniDb } from "./helpers/mini-db";
import {
	deleteNoteRows,
	deleteNotesUnderFolder,
	listNotesUnderFolder,
	renameNoteRows,
} from "../src/indexer/note-rows";

function count(db: Database, sql: string, params: unknown[] = []): number {
	const r = db.exec(sql, params as never);
	return r[0] ? Number(r[0].values[0][0]) : 0;
}

/** 한 경로의 6개 테이블 행 수. */
function rowsFor(db: Database, p: string) {
	return {
		notes: count(db, "SELECT COUNT(*) FROM notes WHERE path = ?", [p]),
		chunks: count(db, "SELECT COUNT(*) FROM chunks WHERE note_path = ?", [p]),
		terms: count(
			db,
			"SELECT COUNT(*) FROM chunk_terms WHERE chunk_id IN (SELECT id FROM chunks WHERE note_path = ?)",
			[p],
		),
		embeddings: count(
			db,
			"SELECT COUNT(*) FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE note_path = ?)",
			[p],
		),
		tags: count(db, "SELECT COUNT(*) FROM note_tags WHERE note_path = ?", [p]),
		lexicon: count(
			db,
			"SELECT COUNT(*) FROM note_lexicon_keys WHERE note_path = ?",
			[p],
		),
	};
}

const ZERO = { notes: 0, chunks: 0, terms: 0, embeddings: 0, tags: 0, lexicon: 0 };

/** 청크 2(각 형태소 2·임베딩 1) + 태그 1 + 어휘 키 1 짜리 노트. 청크 id를 반환. */
function seedNote(m: Awaited<ReturnType<typeof makeMiniDb>>, p: string): number[] {
	m.addNote(p, { weight: 1.0, group: "internal" });
	const ids = [
		m.addChunk(p, { text: "칭의 본문", terms: ["칭의", "본문"], vec: [1, 0] }),
		m.addChunk(p, { text: "은혜 본문", terms: ["은혜", "본문"], vec: [0, 1] }),
	];
	m.addTag(p, "칭의");
	m.addLexiconKey(p, "doctrine", "칭의");
	return ids;
}

describe("note-rows — 삭제", () => {
	it("mini-db는 FK ON(최악 조건)이다", async () => {
		const m = await makeMiniDb();
		expect(count(m.db, "PRAGMA foreign_keys")).toBe(1);
		m.close();
	});

	it("deleteNoteRows: 해당 노트만 6개 테이블에서 0행, 다른 노트 무손실, 반환값 = 지운 노트 수", async () => {
		const m = await makeMiniDb();
		seedNote(m, "A.md");
		seedNote(m, "B.md");
		const before = rowsFor(m.db, "B.md");
		expect(rowsFor(m.db, "A.md")).toEqual({
			notes: 1, chunks: 2, terms: 4, embeddings: 2, tags: 1, lexicon: 1,
		});

		expect(deleteNoteRows(m.db, ["A.md"])).toBe(1);
		expect(rowsFor(m.db, "A.md")).toEqual(ZERO);
		expect(rowsFor(m.db, "B.md")).toEqual(before);
		// 멱등 — 없는 경로는 0
		expect(deleteNoteRows(m.db, ["A.md", "없는노트.md"])).toBe(0);
		m.close();
	});

	it("deleteNotesUnderFolder: 하위 폴더 포함, 접두만 같은 폴더(AB/)와 다른 위치의 동명 폴더(C/A/)는 보존", async () => {
		const m = await makeMiniDb();
		for (const p of ["A/x.md", "A/b/y.md", "AB/z.md", "C/A/w.md"]) seedNote(m, p);

		expect(listNotesUnderFolder(m.db, "A").sort()).toEqual(["A/b/y.md", "A/x.md"]);
		expect(listNotesUnderFolder(m.db, "A/").sort()).toEqual(["A/b/y.md", "A/x.md"]);

		const removed = deleteNotesUnderFolder(m.db, "A");
		expect(removed.sort()).toEqual(["A/b/y.md", "A/x.md"]);
		expect(rowsFor(m.db, "A/x.md")).toEqual(ZERO);
		expect(rowsFor(m.db, "A/b/y.md")).toEqual(ZERO);
		expect(rowsFor(m.db, "AB/z.md").notes).toBe(1);
		expect(rowsFor(m.db, "C/A/w.md").notes).toBe(1);
		// 두 번째 호출은 no-op
		expect(deleteNotesUnderFolder(m.db, "A")).toEqual([]);
		m.close();
	});
});

describe("note-rows — 이름 변경", () => {
	it("renameNoteRows: 청크 id·임베딩 보존, 태그·어휘 키 이동, 그룹·가중치는 새 폴더 값", async () => {
		const m = await makeMiniDb();
		const ids = seedNote(m, "old/제목.md");
		seedNote(m, "other.md");
		const totalEmb = count(m.db, "SELECT COUNT(*) FROM embeddings");
		const totalChunks = count(m.db, "SELECT COUNT(*) FROM chunks");

		const ok = renameNoteRows(m.db, "old/제목.md", "new/새 제목.md", {
			groupId: "external",
			weight: 0.8,
		});
		expect(ok).toBe(true);

		expect(rowsFor(m.db, "old/제목.md")).toEqual(ZERO);
		expect(rowsFor(m.db, "new/새 제목.md")).toEqual({
			notes: 1, chunks: 2, terms: 4, embeddings: 2, tags: 1, lexicon: 1,
		});
		const movedIds = m.db
			.exec("SELECT id FROM chunks WHERE note_path = ? ORDER BY id", ["new/새 제목.md"])[0]
			.values.map((r) => Number(r[0]));
		expect(movedIds).toEqual([...ids].sort((a, b) => a - b));
		// 임베딩·청크 총량 불변(재생성 없음)
		expect(count(m.db, "SELECT COUNT(*) FROM embeddings")).toBe(totalEmb);
		expect(count(m.db, "SELECT COUNT(*) FROM chunks")).toBe(totalChunks);
		const row = m.db.exec(
			"SELECT category_id, weight FROM notes WHERE path = ?",
			["new/새 제목.md"],
		)[0].values[0];
		expect(row[0]).toBe("external");
		expect(Number(row[1])).toBeCloseTo(0.8);
		expect(rowsFor(m.db, "other.md").notes).toBe(1);
		m.close();
	});

	it("범위 밖으로 이동(cat null) → 삭제와 동일", async () => {
		const m = await makeMiniDb();
		seedNote(m, "in/a.md");
		expect(renameNoteRows(m.db, "in/a.md", "out/a.md", null)).toBe(true);
		expect(rowsFor(m.db, "in/a.md")).toEqual(ZERO);
		expect(rowsFor(m.db, "out/a.md")).toEqual(ZERO);
		m.close();
	});

	it("색인 밖 노트의 이름 변경 → false, DB 무변경(멱등)", async () => {
		const m = await makeMiniDb();
		seedNote(m, "keep.md");
		const before = count(m.db, "SELECT COUNT(*) FROM notes");
		expect(
			renameNoteRows(m.db, "미색인.md", "미색인2.md", { groupId: "internal", weight: 1 }),
		).toBe(false);
		expect(renameNoteRows(m.db, "keep.md", "keep.md", { groupId: "internal", weight: 1 })).toBe(false);
		expect(count(m.db, "SELECT COUNT(*) FROM notes")).toBe(before);
		m.close();
	});

	it("새 경로에 낡은 행이 남아 있으면 먼저 정리하고 옮긴다(PK 충돌 없음)", async () => {
		const m = await makeMiniDb();
		const ids = seedNote(m, "src.md");
		m.addNote("dup.md");
		const stale = m.addChunk("dup.md", { text: "낡은 청크", terms: ["낡은"] });
		const totalChunks = count(m.db, "SELECT COUNT(*) FROM chunks");

		expect(
			renameNoteRows(m.db, "src.md", "dup.md", { groupId: "internal", weight: 1 }),
		).toBe(true);
		const nowIds = m.db
			.exec("SELECT id FROM chunks WHERE note_path = ? ORDER BY id", ["dup.md"])[0]
			.values.map((r) => Number(r[0]));
		expect(nowIds).toEqual([...ids].sort((a, b) => a - b));
		expect(nowIds).not.toContain(stale);
		expect(count(m.db, "SELECT COUNT(*) FROM chunks")).toBe(totalChunks - 1);
		expect(rowsFor(m.db, "src.md")).toEqual(ZERO);
		m.close();
	});
});
