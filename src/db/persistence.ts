import { Notice, Plugin, normalizePath } from "obsidian";
import type { Database } from "sql.js";
import { loadSqlJs } from "./sqljs-loader";
import { runMigrations } from "./migrate";
import { compactDbFile } from "./compact";

const DB_FILENAME = "index.db";
const TMP_PREFIX = "index.db.tmp";
const BAK_FILENAME = "index.db.bak";

function dbPath(plugin: Plugin): string {
	return normalizePath(`${plugin.manifest.dir}/${DB_FILENAME}`);
}

// 저장마다 고유한 .tmp 경로 — 리로드로 겹친 신·구 인스턴스가
// 같은 .tmp를 두고 경합하지 않도록 한다
function tmpPath(plugin: Plugin): string {
	return normalizePath(
		`${plugin.manifest.dir}/${TMP_PREFIX}-${Date.now().toString(36)}`,
	);
}

function bakPath(plugin: Plugin): string {
	return normalizePath(`${plugin.manifest.dir}/${BAK_FILENAME}`);
}

/** onMigrated: 스키마 마이그레이션이 실행됐을 때(파일에 아직 반영 안 됨) — 호출부가 dirty 표시. */
export async function loadOrCreateDb(
	plugin: Plugin,
	onMigrated?: () => void,
): Promise<Database> {
	const SQL = await loadSqlJs();
	const adapter = plugin.app.vault.adapter;
	const path = dbPath(plugin);
	const bak = bakPath(plugin);

	// 이전 저장이 실패하며 남긴 고아 .tmp 정리 (구버전 고정명 포함 prefix 매칭)
	try {
		const listing = await adapter.list(normalizePath(`${plugin.manifest.dir}`));
		for (const file of listing.files) {
			const base = file.substring(file.lastIndexOf("/") + 1);
			if (!base.startsWith(TMP_PREFIX)) continue;
			try {
				await adapter.remove(file);
			} catch (e) {
				console.warn("[a4p-sermon-desk] 고아 .tmp 제거 실패", e);
			}
		}
	} catch (e) {
		console.warn("[a4p-sermon-desk] 고아 .tmp 조회 실패", e);
	}

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
			if (runMigrations(db)) onMigrated?.();
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
			// 빈 DB로 시작하기 전에 .bak가 있으면 백업으로 복구 시도
			if (await adapter.exists(bak)) {
				try {
					const db = new SQL.Database(
						new Uint8Array(await adapter.readBinary(bak)),
					);
					if (runMigrations(db)) onMigrated?.();
					console.warn(
						"[a4p-sermon-desk] .bak에서 인덱스 복구됨",
					);
					return db;
				} catch (bakErr) {
					console.error(
						"[a4p-sermon-desk] .bak 로드도 실패",
						bakErr,
					);
				}
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

// 동시 저장·압축 직렬화 — 겹친 저장이 같은 .tmp/.bak를 두고 경합하면
// rename이 상대의 .tmp를 소비해 index.db가 유실될 수 있다
let saveChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
	const next = saveChain.then(job);
	saveChain = next.catch(() => {});
	return next;
}

export function saveDb(plugin: Plugin, db: Database): Promise<void> {
	return enqueue(() => doSave(plugin, db));
}

async function doSave(plugin: Plugin, db: Database): Promise<void> {
	const tmp = tmpPath(plugin);
	const bytes = db.export();
	await replaceWithTmp(plugin, tmp, () =>
		plugin.app.vault.adapter.writeBinary(tmp, bytes.buffer as ArrayBuffer),
	);
}

export interface CompactResult {
	/** 압축 전·후 index.db 크기(바이트). */
	before: number;
	after: number;
}

/**
 * 색인 압축 — 메모리 상태를 먼저 저장한 뒤 디스크의 index.db를 압축 사본으로 바꾼다.
 * 교체는 저장과 같은 순서(직전 파일 .bak 보존)·같은 직렬화 체인을 쓴다.
 * 성공하면 호출부가 openDbFile로 메모리 DB를 다시 열어야 한다 — 그대로 두면
 * 다음 저장이 압축 전의 큰 이미지를 다시 쓴다.
 */
export function compactDb(
	plugin: Plugin,
	db: Database,
): Promise<CompactResult> {
	return enqueue(async () => {
		await doSave(plugin, db);
		const adapter = plugin.app.vault.adapter;
		const path = dbPath(plugin);
		const tmp = tmpPath(plugin);
		const before = (await adapter.stat(path))?.size ?? 0;
		await replaceWithTmp(plugin, tmp, async () =>
			compactDbFile(fullPath(plugin, path), fullPath(plugin, tmp)),
		);
		const after = (await adapter.stat(path))?.size ?? 0;
		return { before, after };
	});
}

/** index.db를 그대로 연다(복구·마이그레이션 없음) — 방금 검사를 통과한 압축 파일을 다시 불러올 때. */
export async function openDbFile(plugin: Plugin): Promise<Database> {
	const SQL = await loadSqlJs();
	return new SQL.Database(
		new Uint8Array(await plugin.app.vault.adapter.readBinary(dbPath(plugin))),
	);
}

function fullPath(plugin: Plugin, p: string): string {
	const adapter = plugin.app.vault.adapter as {
		getFullPath?: (normalizedPath: string) => string;
	};
	if (typeof adapter.getFullPath !== "function") {
		throw new Error("데스크톱 볼트에서만 색인을 압축할 수 있습니다");
	}
	return adapter.getFullPath(p);
}

/** writeTmp로 tmp를 만든 뒤 index.db와 바꾼다 — 저장·압축 공통. */
async function replaceWithTmp(
	plugin: Plugin,
	tmp: string,
	writeTmp: () => Promise<void>,
): Promise<void> {
	const adapter = plugin.app.vault.adapter;
	const path = dbPath(plugin);
	const bak = bakPath(plugin);

	let demoted = false;
	try {
		// 1) 새 인덱스를 임시 파일에 먼저 쓴다
		await writeTmp();
		// 2) 기존 인덱스를 .bak로 보존한 뒤 교체 — 어느 단계에서 중단돼도
		//    index.db 또는 index.db.bak 중 하나는 온전하게 남는다
		if (await adapter.exists(path)) {
			if (await adapter.exists(bak)) await adapter.remove(bak);
			await adapter.rename(path, bak);
			demoted = true;
		}
		await adapter.rename(tmp, path);
		// 3) 교체 성공 — .bak(직전 버전)는 다음 저장 때까지 보관해
		//    index.db가 손상되는 극단 상황에서도 직전 사본이 남게 한다
	} catch (e) {
		// 교체 도중 실패 — .bak로 물러난 원본을 즉시 복원해
		// index.db가 빈 자리로 남지 않게 한다
		if (demoted) {
			try {
				if (
					!(await adapter.exists(path)) &&
					(await adapter.exists(bak))
				) {
					await adapter.rename(bak, path);
				}
			} catch {
				// 복원 실패 시 다음 로드의 .bak 복구 경로가 처리
			}
		}
		// 고아 .tmp 정리 후 rethrow — 사용자 알림은 호출부(Notice)가 담당
		try {
			if (await adapter.exists(tmp)) await adapter.remove(tmp);
		} catch {
			// 정리 실패는 무시 (다음 로드에서 제거됨)
		}
		throw e;
	}
}
