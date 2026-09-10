import type { Database } from "sql.js";
import { applySchema, LEXICON_TABLES_DDL, SCHEMA_VERSION } from "./schema";
import { lexScope, TAG_SCOPE } from "./embeddings";

interface Migration {
	from: number;
	to: number;
	up: (db: Database) => void;
}

const MIGRATIONS: Migration[] = [
	{
		from: 1,
		to: 2,
		up: (db) => {
			db.exec(`
				DROP TABLE IF EXISTS chunk_terms;
				DROP TABLE IF EXISTS embeddings;
				DROP TABLE IF EXISTS chunks;
				DROP TABLE IF EXISTS notes;
				DELETE FROM meta;
			`);
			applySchema(db);
		},
	},
	{
		// 교리 전용 테이블 → 이름 있는 렉시콘으로 일반화(PR-B). 데이터는 무손실 복사:
		// note_doctrines → note_lexicon_keys(lexicon_id='doctrine'),
		// doctrine_embeddings/tag_embeddings → key_embeddings(scope). 청크·청크 임베딩 무관.
		from: 2,
		to: 3,
		up: (db) => {
			db.exec("BEGIN");
			try {
				db.exec(LEXICON_TABLES_DDL);
				db.exec(`
					INSERT OR IGNORE INTO note_lexicon_keys(note_path, lexicon_id, key)
						SELECT note_path, 'doctrine', doctrine_key FROM note_doctrines;
					INSERT OR IGNORE INTO key_embeddings(scope, key, model, dim, vector, embedded_at)
						SELECT '${lexScope("doctrine")}', key, model, dim, vector, embedded_at FROM doctrine_embeddings;
					INSERT OR IGNORE INTO key_embeddings(scope, key, model, dim, vector, embedded_at)
						SELECT '${TAG_SCOPE}', key, model, dim, vector, embedded_at FROM tag_embeddings;
					DROP TABLE IF EXISTS note_doctrines;
					DROP TABLE IF EXISTS doctrine_embeddings;
					DROP TABLE IF EXISTS tag_embeddings;
				`);
				db.exec("COMMIT");
			} catch (e) {
				db.exec("ROLLBACK");
				throw e;
			}
			applySchema(db); // 인덱스 + schema_version=3
		},
	},
];

function readSchemaVersion(db: Database): number {
	try {
		const result = db.exec(
			"SELECT value FROM meta WHERE key='schema_version'",
		);
		const row = result[0]?.values[0]?.[0];
		return row ? parseInt(row as string, 10) : 0;
	} catch {
		return 0;
	}
}

/** 스키마를 최신으로. 버전 간 마이그레이션이 실제로 실행됐으면 true(호출부가 저장 예약). */
export function runMigrations(db: Database): boolean {
	const current = readSchemaVersion(db);

	if (current === 0) {
		applySchema(db);
		return false;
	}

	if (current === SCHEMA_VERSION) return false;

	if (current > SCHEMA_VERSION) {
		throw new Error(
			`[a4p-sermon-desk] DB schema version ${current} is newer than supported ${SCHEMA_VERSION}. Please update the plugin.`,
		);
	}

	let v = current;
	while (v < SCHEMA_VERSION) {
		const m = MIGRATIONS.find((x) => x.from === v);
		if (!m) {
			throw new Error(
				`[a4p-sermon-desk] no migration path from schema version ${v}`,
			);
		}
		m.up(db);
		v = m.to;
	}
	return true;
}
