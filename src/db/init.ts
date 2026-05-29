import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  project_dir     TEXT NOT NULL,
  project_label   TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  file_mtime      INTEGER NOT NULL,
  file_size       INTEGER NOT NULL,
  started_at      INTEGER,
  last_activity   INTEGER,
  git_branch      TEXT,
  message_count   INTEGER NOT NULL DEFAULT 0,
  user_msg_count  INTEGER NOT NULL DEFAULT 0,
  compact_count   INTEGER NOT NULL DEFAULT 0,
  first_prompt    TEXT,
  ai_title        TEXT,
  cwd             TEXT,
  indexed_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project       ON sessions(project_dir, last_activity DESC);

CREATE TABLE IF NOT EXISTS messages (
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  line_no             INTEGER NOT NULL,
  uuid                TEXT,
  parent_uuid         TEXT,
  type                TEXT NOT NULL,
  role                TEXT,
  is_sidechain        INTEGER NOT NULL DEFAULT 0,
  is_compact_summary  INTEGER NOT NULL DEFAULT 0,
  timestamp           INTEGER,
  text_content        TEXT,
  raw_json            TEXT NOT NULL,
  PRIMARY KEY (session_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, line_no);
CREATE INDEX IF NOT EXISTS idx_messages_compact ON messages(session_id, is_compact_summary);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text_content,
  content='messages',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text_content) VALUES (new.rowid, new.text_content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text_content) VALUES('delete', old.rowid, old.text_content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text_content) VALUES('delete', old.rowid, old.text_content);
  INSERT INTO messages_fts(rowid, text_content) VALUES (new.rowid, new.text_content);
END;

CREATE TABLE IF NOT EXISTS session_tags (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (session_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags ON session_tags(tag, session_id);

CREATE TABLE IF NOT EXISTS session_exports (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  format      TEXT NOT NULL,
  exported_at INTEGER NOT NULL,
  out_path    TEXT NOT NULL,
  PRIMARY KEY (session_id, format, exported_at)
);

-- Repo-identity resolution (Layer 1): an absolute working directory annotated
-- with its captured immutable identity tokens. Captured at index time while
-- the directory still exists; persisted keyed by path. See the design doc.
CREATE TABLE IF NOT EXISTS workdirs (
  path           TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,          -- git | manifest | path
  remote         TEXT,                   -- credential-stripped host/org/repo
  manifest_name  TEXT,
  root_commit    TEXT,
  exists_on_disk INTEGER NOT NULL DEFAULT 0,
  resolved_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workdir_tokens (
  path  TEXT NOT NULL REFERENCES workdirs(path) ON DELETE CASCADE,
  token TEXT NOT NULL,
  PRIMARY KEY (path, token)
);
CREATE INDEX IF NOT EXISTS idx_workdir_tokens_token ON workdir_tokens(token);

-- User-chosen directory prefixes to hide from all views (and skip at index
-- time). Lossless: existing rows are kept, just filtered — toggling is instant.
CREATE TABLE IF NOT EXISTS excluded_prefixes (
  prefix      TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL
);
`;

export function openDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  const cols = db.pragma("table_info(sessions)") as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "cwd")) {
    db.exec("ALTER TABLE sessions ADD COLUMN cwd TEXT");
  }
  return db;
}
