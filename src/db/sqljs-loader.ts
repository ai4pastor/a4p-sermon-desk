import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import wasmBytes from "../../node_modules/sql.js/dist/sql-wasm.wasm";

let cached: SqlJsStatic | null = null;

export async function loadSqlJs(): Promise<SqlJsStatic> {
	if (cached) return cached;
	cached = await initSqlJs({
		wasmBinary: wasmBytes.buffer as ArrayBuffer,
	});
	return cached;
}

export async function createDatabase(): Promise<Database> {
	const SQL = await loadSqlJs();
	return new SQL.Database();
}
