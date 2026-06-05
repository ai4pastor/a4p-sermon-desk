import type { Database } from "sql.js";

export const SCHEMA_VERSION = 2;

const DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  path TEXT PRIMARY KEY,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  category_id TEXT,
  weight REAL NOT NULL DEFAULT 1.0,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_path TEXT NOT NULL,
  ord INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  FOREIGN KEY (note_path) REFERENCES notes(path) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id INTEGER PRIMARY KEY,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chunk_terms (
  chunk_id INTEGER NOT NULL,
  term TEXT NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS note_doctrines (
  note_path TEXT NOT NULL,
  doctrine_key TEXT NOT NULL,
  PRIMARY KEY (note_path, doctrine_key),
  FOREIGN KEY (note_path) REFERENCES notes(path) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_path TEXT NOT NULL,
  tag_key TEXT NOT NULL,
  PRIMARY KEY (note_path, tag_key),
  FOREIGN KEY (note_path) REFERENCES notes(path) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS doctrine_embeddings (
  key TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  embedded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_embeddings (
  key TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  embedded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_note ON chunks(note_path);
CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category_id);
CREATE INDEX IF NOT EXISTS idx_chunk_terms_term ON chunk_terms(term);
CREATE INDEX IF NOT EXISTS idx_chunk_terms_chunk ON chunk_terms(chunk_id);
CREATE INDEX IF NOT EXISTS idx_note_doctrines_key ON note_doctrines(doctrine_key);
CREATE INDEX IF NOT EXISTS idx_note_tags_key ON note_tags(tag_key);

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');
`;

export function applySchema(db: Database): void {
	db.exec(DDL);
}
