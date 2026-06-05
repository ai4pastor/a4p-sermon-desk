import type { Database } from "sql.js";
import { applySchema, SCHEMA_VERSION } from "./schema";

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

export function runMigrations(db: Database): void {
	const current = readSchemaVersion(db);

	if (current === 0) {
		applySchema(db);
		return;
	}

	if (current === SCHEMA_VERSION) return;

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
}
