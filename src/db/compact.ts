// 색인 압축 — 범위를 줄인 뒤 index.db에 남는 빈 공간(지운 행의 페이지)을 걷어낸다.
// sql.js 안에서 제자리 VACUUM을 돌리면 메모리가 파일 크기의 약 6배까지 치솟아
// (실측: 322MB 파일 +1.8GB, 424MB 파일 +2.5GB) 큰 볼트에서 앱이 죽을 수 있다.
// 그래서 옵시디언 데스크톱의 내장 SQLite(node:sqlite)로 디스크의 파일을 새 파일로
// VACUUM INTO 한다(실측 +6MB, 원본은 읽기만). 옛 설치 파일(Electron)에는 없을 수 있다.

interface NativeStatement {
	get(...params: unknown[]): Record<string, unknown> | undefined;
}

interface NativeDatabase {
	exec(sql: string): void;
	prepare(sql: string): NativeStatement;
	close(): void;
}

export interface NativeSqlite {
	DatabaseSync: new (
		path: string,
		options?: { readOnly?: boolean },
	) => NativeDatabase;
}

let injected: NativeSqlite | null | undefined;

/** 테스트 전용 — ESM 테스트 환경에는 require가 없어 모듈을 직접 넣는다. undefined면 해제. */
export function setNativeSqliteForTests(mod: NativeSqlite | null | undefined): void {
	injected = mod;
}

function loadNativeSqlite(): NativeSqlite | null {
	if (injected !== undefined) return injected;
	try {
		// 번들에 넣지 않고(esbuild external) 실행 시점에 찾는다.
		return require("node:sqlite") as NativeSqlite;
	} catch {
		return null;
	}
}

/** 이 옵시디언에서 색인 압축을 쓸 수 있는지(내장 SQLite 유무). */
export function isCompactAvailable(): boolean {
	return loadNativeSqlite() !== null;
}

// 압축 전후 비교용 행 수 — 내용이 그대로인지 확인한다.
const COUNT_TABLES = [
	"notes",
	"chunks",
	"embeddings",
	"chunk_terms",
	"note_tags",
	"note_lexicon_keys",
	"key_embeddings",
];

function rowCounts(db: NativeDatabase): string {
	return COUNT_TABLES.map(
		(t) => `${t}=${Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()?.n)}`,
	).join(" ");
}

/**
 * srcPath(디스크의 index.db)를 읽어 outPath에 압축 사본을 만들고 검사한다.
 * src는 읽기만 한다. 검사(quick_check·행 수 일치)를 통과하지 못하면 예외를 던지므로
 * 호출부는 예외가 없을 때만 교체한다. outPath에 파일이 이미 있으면 SQLite가 거부한다.
 */
export function compactDbFile(srcPath: string, outPath: string): void {
	const sqlite = loadNativeSqlite();
	if (!sqlite) {
		throw new Error("이 옵시디언 설치 버전에서는 색인 압축을 쓸 수 없습니다");
	}
	const src = new sqlite.DatabaseSync(srcPath, { readOnly: true });
	let before: string;
	try {
		before = rowCounts(src);
		src.exec(`VACUUM INTO '${outPath.replace(/'/g, "''")}'`);
	} finally {
		src.close();
	}
	const out = new sqlite.DatabaseSync(outPath, { readOnly: true });
	try {
		const qc = out.prepare("PRAGMA quick_check").get();
		const result = qc ? String(Object.values(qc)[0]) : "(결과 없음)";
		if (result !== "ok") throw new Error(`압축 사본 검사 실패: ${result}`);
		const after = rowCounts(out);
		if (after !== before) {
			throw new Error(`압축 사본 행 수 불일치: ${before} → ${after}`);
		}
	} finally {
		out.close();
	}
}
