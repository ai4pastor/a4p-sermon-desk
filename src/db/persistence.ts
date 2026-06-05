import { Notice, Plugin, normalizePath } from "obsidian";
import type { Database } from "sql.js";
import { loadSqlJs } from "./sqljs-loader";
import { runMigrations } from "./migrate";

const DB_FILENAME = "index.db";
const TMP_FILENAME = "index.db.tmp";
const BAK_FILENAME = "index.db.bak";

function dbPath(plugin: Plugin): string {
	return normalizePath(`${plugin.manifest.dir}/${DB_FILENAME}`);
}

function tmpPath(plugin: Plugin): string {
	return normalizePath(`${plugin.manifest.dir}/${TMP_FILENAME}`);
}

function bakPath(plugin: Plugin): string {
	return normalizePath(`${plugin.manifest.dir}/${BAK_FILENAME}`);
}

export async function loadOrCreateDb(plugin: Plugin): Promise<Database> {
	const SQL = await loadSqlJs();
	const adapter = plugin.app.vault.adapter;
	const path = dbPath(plugin);
	const bak = bakPath(plugin);

	// 이전 저장이 교체 도중 중단돼 index.db가 사라지고 .bak만 남은 경우 복구
	if (!(await adapter.exists(path)) && (await adapter.exists(bak))) {
		console.warn("[a4p-sermon-desk] index.db 없음 — .bak에서 복구합니다");
		try {
			await adapter.rename(bak, path);
		} catch (e) {
			console.error("[a4p-sermon-desk] .bak 복구 실패", e);
		}
	}

	if (await adapter.exists(path)) {
		try {
			const db = new SQL.Database(
				new Uint8Array(await adapter.readBinary(path)),
			);
			runMigrations(db);
			return db;
		} catch (e) {
			console.error("[a4p-sermon-desk] index.db 로드 실패, 재생성", e);
			const backup = normalizePath(
				`${plugin.manifest.dir}/index.db.corrupt-${Date.now()}`,
			);
			try {
				await adapter.rename(path, backup);
			} catch (renameErr) {
				console.error(
					"[a4p-sermon-desk] 손상 DB 백업 실패",
					renameErr,
				);
			}
			new Notice(
				"A4P Sermon Desk: 인덱스 DB가 손상되어 새로 만들었습니다. 명령 팔레트에서 'Reindex all notes'를 실행하세요.",
			);
		}
	}
	const db = new SQL.Database();
	runMigrations(db);
	return db;
}

export async function saveDb(plugin: Plugin, db: Database): Promise<void> {
	const adapter = plugin.app.vault.adapter;
	const path = dbPath(plugin);
	const tmp = tmpPath(plugin);
	const bak = bakPath(plugin);
	const bytes = db.export();

	// 1) 새 인덱스를 임시 파일에 먼저 쓴다
	await adapter.writeBinary(tmp, bytes.buffer as ArrayBuffer);
	// 2) 기존 인덱스를 .bak로 보존한 뒤 교체 — 어느 단계에서 중단돼도
	//    index.db 또는 index.db.bak 중 하나는 온전하게 남는다
	if (await adapter.exists(path)) {
		if (await adapter.exists(bak)) await adapter.remove(bak);
		await adapter.rename(path, bak);
	}
	await adapter.rename(tmp, path);
	// 3) 교체 성공 — 백업 제거
	if (await adapter.exists(bak)) await adapter.remove(bak);
}
