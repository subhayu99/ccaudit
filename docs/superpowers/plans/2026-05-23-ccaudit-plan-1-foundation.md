# ccaudit Plan 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the ccaudit npm package with a SQLite+FTS5 index of all Claude Code sessions on disk and a usable CLI with `reindex`, `list`, `search`, and `doctor` subcommands.

**Architecture:** Single npm package with module folders. `better-sqlite3` for synchronous SQLite + FTS5. `commander` for the CLI. Vitest for tests. Indexer streams JSONL files line-by-line and stores cleaned text in an FTS5-indexed messages table; the original line is preserved verbatim in `raw_json` for future-proof rendering.

**Tech Stack:** Node 20+, TypeScript 5.4+, `better-sqlite3`, `commander`, `kleur` (terminal colors), `vitest`, `tsx` (dev runner), `tsup` (build).

**Spec reference:** `docs/superpowers/specs/2026-05-23-ccaudit-design.md` — Sections 2–4 and 6.

---

## File Structure

Files this plan creates (relative to project root `/Users/subhayu/Downloads/ccaudit/`):

| Path | Purpose |
|------|---------|
| `package.json` | Package metadata, bin entry, deps, scripts |
| `tsconfig.json` | TypeScript config (strict, ESNext, Node moduleResolution) |
| `tsup.config.ts` | Build config (CLI bundle) |
| `vitest.config.ts` | Test config |
| `.gitignore` | node_modules, dist, ~/.ccaudit (if symlinked into repo) |
| `src/types.ts` | Shared types (`Session`, `MessageRow`, `SearchHit`, `RawMessage`) |
| `src/paths.ts` | `~/.ccaudit/` and `~/.claude/projects/` path helpers |
| `src/db/init.ts` | SQLite open + schema creation + FTS5 triggers |
| `src/db/sessions.ts` | Sessions table queries |
| `src/db/messages.ts` | Messages table queries + FTS5 search |
| `src/db/tags.ts` | Tags table queries |
| `src/indexer/walk.ts` | Walk `~/.claude/projects/`, list session files |
| `src/indexer/parse.ts` | Stream a JSONL file and yield parsed messages |
| `src/indexer/extract.ts` | Extract clean `text_content` per message type |
| `src/indexer/aggregate.ts` | Compute per-session aggregates while streaming |
| `src/indexer/index-runner.ts` | Orchestrator: walk → check mtime → parse → upsert |
| `src/cli/index.ts` | `bin` entry; commander setup; subcommand wiring |
| `src/cli/reindex.ts` | `ccaudit reindex` command |
| `src/cli/list.ts` | `ccaudit list` command (table output) |
| `src/cli/search.ts` | `ccaudit search <q>` command |
| `src/cli/doctor.ts` | `ccaudit doctor` command |
| `tests/fixtures/projects/basic/session-aaa.jsonl` | Fixture: ordinary session |
| `tests/fixtures/projects/compact/session-bbb.jsonl` | Fixture: session with `/compact` events |
| `tests/fixtures/projects/sidechain/session-ccc.jsonl` | Fixture: session with sidechain messages |
| `tests/fixtures/projects/malformed/session-ddd.jsonl` | Fixture: includes one malformed line |
| `tests/db.test.ts` | Schema, FTS5 triggers |
| `tests/indexer.test.ts` | Walker, parser, extractor, aggregator, runner |
| `tests/cli.test.ts` | Smoke tests for subcommands |

---

## Phase A — Bootstrap

### Task A1: Initialize package, git, and folder structure

**Files:**
- Create: `package.json`, `.gitignore`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `README.md`

- [ ] **Step 1: Initialize git repo and folder skeleton**

```bash
cd /Users/subhayu/Downloads/ccaudit
git init
mkdir -p src/{db,indexer,cli} tests/fixtures/projects/{basic,compact,sidechain,malformed}
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "ccaudit",
  "version": "0.0.1",
  "description": "Browse, search, and audit your Claude Code session history",
  "type": "module",
  "bin": {
    "ccaudit": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "better-sqlite3": "^11.5.0",
    "commander": "^12.1.0",
    "kleur": "^4.1.5"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.7.0",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "license": "MIT"
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
.env
.env.local
coverage/
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "tests/**/*", "*.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Write `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  shims: true,
  banner: { js: "#!/usr/bin/env node" },
  dts: false,
});
```

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` populated; no audit errors that block install.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore tsconfig.json tsup.config.ts vitest.config.ts
git commit -m "feat: bootstrap ccaudit npm package with TS, vitest, and tsup"
```

---

### Task A2: Shared types and path helpers

**Files:**
- Create: `src/types.ts`, `src/paths.ts`
- Test: (paths.ts is tested implicitly via indexer tests)

- [ ] **Step 1: Write `src/types.ts`**

```ts
// Session row mirrored from SQLite. `null` where the source value was missing.
export type Session = {
  id: string;
  projectDir: string;
  projectLabel: string;
  filePath: string;
  fileMtime: number;
  fileSize: number;
  startedAt: number | null;
  lastActivity: number | null;
  gitBranch: string | null;
  messageCount: number;
  userMsgCount: number;
  compactCount: number;
  firstPrompt: string | null;
  aiTitle: string | null;
  indexedAt: number;
};

export type MessageRow = {
  sessionId: string;
  lineNo: number;
  uuid: string | null;
  parentUuid: string | null;
  type: string;
  role: string | null;
  isSidechain: boolean;
  isCompactSummary: boolean;
  timestamp: number | null;
  textContent: string | null;
  rawJson: string;
};

export type SearchHit = {
  sessionId: string;
  lineNo: number;
  snippet: string;
  rank: number;
};

// Raw JSONL message — a loose subset; unknown fields are preserved via raw_json.
export type RawMessage = {
  type: string;
  uuid?: string;
  parentUuid?: string;
  sessionId?: string;
  timestamp?: string | number;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  cwd?: string;
  gitBranch?: string;
  message?: {
    role?: string;
    content?: unknown; // string | Array<{type, text?, ...}>
  };
  // ai-title messages
  title?: string;
};
```

- [ ] **Step 2: Write `src/paths.ts`**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
export const CCAUDIT_DIR = join(homedir(), ".ccaudit");
export const INDEX_DB_PATH = join(CCAUDIT_DIR, "index.db");
export const EXPORTS_DIR = join(CCAUDIT_DIR, "exports");
export const LOGS_DIR = join(CCAUDIT_DIR, "logs");

// Decode the dir-hash back to a real path. Claude Code stores
// ~/foo/bar as "-foo-bar" (slashes -> dashes, leading slash -> leading dash).
export function decodeProjectDir(encoded: string): string {
  return encoded.replace(/-/g, "/");
}

// Short label = last two path segments, e.g. "LoopProjects/backend"
export function projectLabel(realPath: string): string {
  const parts = realPath.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/paths.ts
git commit -m "feat: shared types and ~/.ccaudit / ~/.claude/projects path helpers"
```

---

## Phase B — DB layer (SQLite + FTS5)

### Task B1: DB init — schema, FTS5, triggers

**Files:**
- Create: `src/db/init.ts`
- Test: `tests/db.test.ts`

- [ ] **Step 1: Write failing test `tests/db.test.ts` (schema creation)**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";

describe("db/init", () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    dbPath = join(tmp, "test.db");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates the sessions, messages, tags, exports tables and the FTS5 vtable", () => {
    const db = openDb(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual') ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "sessions",
        "messages",
        "messages_fts",
        "session_tags",
        "session_exports",
      ])
    );
    db.close();
  });

  it("creates the three FTS5 sync triggers on the messages table", () => {
    const db = openDb(dbPath);
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = triggers.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "messages_ai", // after insert
        "messages_ad", // after delete
        "messages_au", // after update
      ])
    );
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/db.test.ts
```

Expected: FAIL — `Cannot find module '../src/db/init.js'`.

- [ ] **Step 3: Write `src/db/init.ts`**

```ts
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
`;

export function openDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/db.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/init.ts tests/db.test.ts
git commit -m "feat(db): schema, FTS5 vtable, and sync triggers with tests"
```

---

### Task B2: Sessions table queries

**Files:**
- Create: `src/db/sessions.ts`
- Modify: `tests/db.test.ts` (add upsert/select tests)

- [ ] **Step 1: Add failing test in `tests/db.test.ts`**

Append to the `describe("db/init"...` block a sibling `describe`:

```ts
import { upsertSession, getSession, listSessions } from "../src/db/sessions.js";
import type { Session } from "../src/types.js";

describe("db/sessions", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const fixture = (overrides: Partial<Session> = {}): Session => ({
    id: "sess-1",
    projectDir: "/Users/x/proj",
    projectLabel: "x/proj",
    filePath: "/tmp/sess-1.jsonl",
    fileMtime: 1000,
    fileSize: 42,
    startedAt: 900,
    lastActivity: 950,
    gitBranch: "main",
    messageCount: 5,
    userMsgCount: 2,
    compactCount: 0,
    firstPrompt: "hello",
    aiTitle: null,
    indexedAt: 1100,
    ...overrides,
  });

  it("upserts and retrieves a session", () => {
    upsertSession(db, fixture());
    const got = getSession(db, "sess-1");
    expect(got).not.toBeNull();
    expect(got!.projectLabel).toBe("x/proj");
    expect(got!.messageCount).toBe(5);
  });

  it("upsert replaces existing row", () => {
    upsertSession(db, fixture());
    upsertSession(db, fixture({ messageCount: 99 }));
    expect(getSession(db, "sess-1")!.messageCount).toBe(99);
  });

  it("listSessions orders by last_activity desc and applies limit/offset", () => {
    upsertSession(db, fixture({ id: "a", lastActivity: 100 }));
    upsertSession(db, fixture({ id: "b", lastActivity: 200 }));
    upsertSession(db, fixture({ id: "c", lastActivity: 150 }));
    const rows = listSessions(db, { limit: 10, offset: 0 });
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("listSessions filters by project_dir", () => {
    upsertSession(db, fixture({ id: "a", projectDir: "/p1" }));
    upsertSession(db, fixture({ id: "b", projectDir: "/p2" }));
    const rows = listSessions(db, { projectDir: "/p1" });
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/db.test.ts
```

Expected: FAIL — module `../src/db/sessions.js` not found.

- [ ] **Step 3: Write `src/db/sessions.ts`**

```ts
import type Database from "better-sqlite3";
import type { Session } from "../types.js";

type SessionRowSql = {
  id: string;
  project_dir: string;
  project_label: string;
  file_path: string;
  file_mtime: number;
  file_size: number;
  started_at: number | null;
  last_activity: number | null;
  git_branch: string | null;
  message_count: number;
  user_msg_count: number;
  compact_count: number;
  first_prompt: string | null;
  ai_title: string | null;
  indexed_at: number;
};

function rowToSession(r: SessionRowSql): Session {
  return {
    id: r.id,
    projectDir: r.project_dir,
    projectLabel: r.project_label,
    filePath: r.file_path,
    fileMtime: r.file_mtime,
    fileSize: r.file_size,
    startedAt: r.started_at,
    lastActivity: r.last_activity,
    gitBranch: r.git_branch,
    messageCount: r.message_count,
    userMsgCount: r.user_msg_count,
    compactCount: r.compact_count,
    firstPrompt: r.first_prompt,
    aiTitle: r.ai_title,
    indexedAt: r.indexed_at,
  };
}

export function upsertSession(db: Database.Database, s: Session): void {
  db.prepare(
    `INSERT INTO sessions
       (id, project_dir, project_label, file_path, file_mtime, file_size,
        started_at, last_activity, git_branch, message_count, user_msg_count,
        compact_count, first_prompt, ai_title, indexed_at)
     VALUES
       (@id, @projectDir, @projectLabel, @filePath, @fileMtime, @fileSize,
        @startedAt, @lastActivity, @gitBranch, @messageCount, @userMsgCount,
        @compactCount, @firstPrompt, @aiTitle, @indexedAt)
     ON CONFLICT(id) DO UPDATE SET
       project_dir   = excluded.project_dir,
       project_label = excluded.project_label,
       file_path     = excluded.file_path,
       file_mtime    = excluded.file_mtime,
       file_size     = excluded.file_size,
       started_at    = excluded.started_at,
       last_activity = excluded.last_activity,
       git_branch    = excluded.git_branch,
       message_count = excluded.message_count,
       user_msg_count = excluded.user_msg_count,
       compact_count = excluded.compact_count,
       first_prompt  = excluded.first_prompt,
       ai_title      = excluded.ai_title,
       indexed_at    = excluded.indexed_at`
  ).run(s);
}

export function getSession(db: Database.Database, id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRowSql | undefined;
  return row ? rowToSession(row) : null;
}

export type ListSessionsOptions = {
  limit?: number;
  offset?: number;
  projectDir?: string;
};

export function listSessions(db: Database.Database, opts: ListSessionsOptions = {}): Session[] {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const where: string[] = [];
  const params: Record<string, unknown> = { limit, offset };
  if (opts.projectDir) {
    where.push("project_dir = @projectDir");
    params.projectDir = opts.projectDir;
  }
  const sql = `
    SELECT * FROM sessions
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY last_activity DESC, id DESC
    LIMIT @limit OFFSET @offset
  `;
  const rows = db.prepare(sql).all(params) as SessionRowSql[];
  return rows.map(rowToSession);
}

export function getSessionByFilePath(db: Database.Database, filePath: string): Session | null {
  const row = db
    .prepare("SELECT * FROM sessions WHERE file_path = ?")
    .get(filePath) as SessionRowSql | undefined;
  return row ? rowToSession(row) : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/db.test.ts
```

Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/sessions.ts tests/db.test.ts
git commit -m "feat(db): sessions upsert/get/list helpers with tests"
```

---

### Task B3: Messages table queries + FTS5 search

**Files:**
- Create: `src/db/messages.ts`
- Modify: `tests/db.test.ts` (add messages + search tests)

- [ ] **Step 1: Add failing tests in `tests/db.test.ts`**

```ts
import {
  insertMessages,
  deleteSessionMessages,
  getSessionMessages,
  searchMessages,
} from "../src/db/messages.js";
import type { MessageRow } from "../src/types.js";

describe("db/messages", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
    upsertSession(db, {
      id: "s1",
      projectDir: "/p",
      projectLabel: "p",
      filePath: "/p/s1.jsonl",
      fileMtime: 0,
      fileSize: 0,
      startedAt: null,
      lastActivity: null,
      gitBranch: null,
      messageCount: 0,
      userMsgCount: 0,
      compactCount: 0,
      firstPrompt: null,
      aiTitle: null,
      indexedAt: 0,
    });
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const msg = (overrides: Partial<MessageRow>): MessageRow => ({
    sessionId: "s1",
    lineNo: 1,
    uuid: null,
    parentUuid: null,
    type: "user",
    role: "user",
    isSidechain: false,
    isCompactSummary: false,
    timestamp: null,
    textContent: "hello world",
    rawJson: "{}",
    ...overrides,
  });

  it("inserts and retrieves messages in line order", () => {
    insertMessages(db, [msg({ lineNo: 2, textContent: "second" }), msg({ lineNo: 1, textContent: "first" })]);
    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.lineNo)).toEqual([1, 2]);
    expect(rows[0]!.textContent).toBe("first");
  });

  it("deleteSessionMessages removes all rows for a session", () => {
    insertMessages(db, [msg({ lineNo: 1 }), msg({ lineNo: 2 })]);
    deleteSessionMessages(db, "s1");
    expect(getSessionMessages(db, "s1")).toEqual([]);
  });

  it("FTS5 search returns messages matching the query", () => {
    insertMessages(db, [
      msg({ lineNo: 1, textContent: "the quick brown fox" }),
      msg({ lineNo: 2, textContent: "lazy dog jumps" }),
    ]);
    const hits = searchMessages(db, "fox");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sessionId).toBe("s1");
    expect(hits[0]!.lineNo).toBe(1);
    expect(hits[0]!.snippet).toContain("fox");
  });

  it("FTS5 search applies porter stemming", () => {
    insertMessages(db, [msg({ lineNo: 1, textContent: "the dogs were running" })]);
    const hits = searchMessages(db, "dog");
    expect(hits).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/db.test.ts
```

Expected: FAIL — `../src/db/messages.js` not found.

- [ ] **Step 3: Write `src/db/messages.ts`**

```ts
import type Database from "better-sqlite3";
import type { MessageRow, SearchHit } from "../types.js";

type MessageRowSql = {
  session_id: string;
  line_no: number;
  uuid: string | null;
  parent_uuid: string | null;
  type: string;
  role: string | null;
  is_sidechain: number;
  is_compact_summary: number;
  timestamp: number | null;
  text_content: string | null;
  raw_json: string;
};

function rowToMessage(r: MessageRowSql): MessageRow {
  return {
    sessionId: r.session_id,
    lineNo: r.line_no,
    uuid: r.uuid,
    parentUuid: r.parent_uuid,
    type: r.type,
    role: r.role,
    isSidechain: r.is_sidechain === 1,
    isCompactSummary: r.is_compact_summary === 1,
    timestamp: r.timestamp,
    textContent: r.text_content,
    rawJson: r.raw_json,
  };
}

export function insertMessages(db: Database.Database, rows: MessageRow[]): void {
  const stmt = db.prepare(
    `INSERT INTO messages
       (session_id, line_no, uuid, parent_uuid, type, role,
        is_sidechain, is_compact_summary, timestamp, text_content, raw_json)
     VALUES
       (@sessionId, @lineNo, @uuid, @parentUuid, @type, @role,
        @isSidechain, @isCompactSummary, @timestamp, @textContent, @rawJson)`
  );
  const tx = db.transaction((batch: MessageRow[]) => {
    for (const r of batch) {
      stmt.run({
        sessionId: r.sessionId,
        lineNo: r.lineNo,
        uuid: r.uuid,
        parentUuid: r.parentUuid,
        type: r.type,
        role: r.role,
        isSidechain: r.isSidechain ? 1 : 0,
        isCompactSummary: r.isCompactSummary ? 1 : 0,
        timestamp: r.timestamp,
        textContent: r.textContent,
        rawJson: r.rawJson,
      });
    }
  });
  tx(rows);
}

export function deleteSessionMessages(db: Database.Database, sessionId: string): void {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
}

export function getSessionMessages(db: Database.Database, sessionId: string): MessageRow[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY line_no ASC")
    .all(sessionId) as MessageRowSql[];
  return rows.map(rowToMessage);
}

export function searchMessages(
  db: Database.Database,
  query: string,
  opts: { limit?: number } = {}
): SearchHit[] {
  const limit = opts.limit ?? 50;
  // FTS5 snippet(): table, column, before, after, ellipsis, max-tokens
  const rows = db
    .prepare(
      `SELECT m.session_id   AS sessionId,
              m.line_no      AS lineNo,
              snippet(messages_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet,
              bm25(messages_fts) AS rank
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
        WHERE messages_fts MATCH ?
        ORDER BY rank ASC
        LIMIT ?`
    )
    .all(query, limit) as Array<{ sessionId: string; lineNo: number; snippet: string; rank: number }>;
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/db.test.ts
```

Expected: PASS, all 10 tests in `tests/db.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/db/messages.ts tests/db.test.ts
git commit -m "feat(db): messages CRUD and FTS5 search with snippet highlighting"
```

---

### Task B4: Tags table queries

**Files:**
- Create: `src/db/tags.ts`
- Modify: `tests/db.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import { addTag, removeTag, getSessionTags, getSessionsByTag } from "../src/db/tags.js";

describe("db/tags", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
    for (const id of ["s1", "s2"]) {
      upsertSession(db, {
        id, projectDir: "/p", projectLabel: "p", filePath: `/p/${id}.jsonl`,
        fileMtime: 0, fileSize: 0, startedAt: null, lastActivity: null,
        gitBranch: null, messageCount: 0, userMsgCount: 0, compactCount: 0,
        firstPrompt: null, aiTitle: null, indexedAt: 0,
      });
    }
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it("adds and lists tags for a session", () => {
    addTag(db, "s1", "Audit", Date.now());
    addTag(db, "s1", "ops", Date.now());
    expect(getSessionTags(db, "s1").sort()).toEqual(["Audit", "ops"]);
  });

  it("addTag is idempotent (same case)", () => {
    addTag(db, "s1", "ops", Date.now());
    addTag(db, "s1", "ops", Date.now());
    expect(getSessionTags(db, "s1")).toEqual(["ops"]);
  });

  it("getSessionsByTag is case-insensitive but display case is preserved", () => {
    addTag(db, "s1", "Audit", Date.now());
    addTag(db, "s2", "audit", Date.now());
    const hits = getSessionsByTag(db, "AUDIT");
    expect(hits.sort()).toEqual(["s1", "s2"]);
  });

  it("removeTag removes only the matching tag", () => {
    addTag(db, "s1", "ops", Date.now());
    addTag(db, "s1", "Audit", Date.now());
    removeTag(db, "s1", "ops");
    expect(getSessionTags(db, "s1")).toEqual(["Audit"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/db.test.ts
```

Expected: FAIL — `../src/db/tags.js` not found.

- [ ] **Step 3: Write `src/db/tags.ts`**

```ts
import type Database from "better-sqlite3";

// Tag validation per spec: trimmed, non-empty, max 64 chars.
function normalize(input: string): string {
  const t = input.trim();
  if (!t) throw new Error("Tag cannot be empty");
  if (t.length > 64) throw new Error("Tag exceeds 64 character limit");
  return t;
}

export function addTag(db: Database.Database, sessionId: string, tag: string, createdAt: number): void {
  const t = normalize(tag);
  db.prepare(
    `INSERT INTO session_tags (session_id, tag, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id, tag) DO NOTHING`
  ).run(sessionId, t, createdAt);
}

export function removeTag(db: Database.Database, sessionId: string, tag: string): void {
  db.prepare("DELETE FROM session_tags WHERE session_id = ? AND tag = ?").run(sessionId, normalize(tag));
}

export function getSessionTags(db: Database.Database, sessionId: string): string[] {
  const rows = db
    .prepare("SELECT tag FROM session_tags WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

export function getSessionsByTag(db: Database.Database, tag: string): string[] {
  const rows = db
    .prepare(
      "SELECT session_id FROM session_tags WHERE LOWER(tag) = LOWER(?) ORDER BY created_at DESC"
    )
    .all(normalize(tag)) as Array<{ session_id: string }>;
  return rows.map((r) => r.session_id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/db.test.ts
```

Expected: PASS, all tests in `tests/db.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/db/tags.ts tests/db.test.ts
git commit -m "feat(db): tags add/remove/list with case-insensitive matching"
```

---

## Phase C — Indexer

### Task C1: Project directory walker

**Files:**
- Create: `src/indexer/walk.ts`
- Create: `tests/fixtures/projects/basic/session-aaa.jsonl` (minimal one-line fixture)
- Test: `tests/indexer.test.ts`

- [ ] **Step 1: Create a minimal fixture file**

`tests/fixtures/projects/basic/session-aaa.jsonl`:

```json
{"type":"user","sessionId":"aaa","timestamp":"2026-05-23T10:00:00Z","cwd":"/Users/x/proj","gitBranch":"main","message":{"role":"user","content":"hello"}}
{"type":"assistant","sessionId":"aaa","timestamp":"2026-05-23T10:00:05Z","message":{"role":"assistant","content":[{"type":"text","text":"hi there"}]}}
```

- [ ] **Step 2: Write failing test in `tests/indexer.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walkProjects } from "../src/indexer/walk.js";

describe("indexer/walk", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-walk-"));
    mkdirSync(join(tmp, "-Users-x-proj"));
    mkdirSync(join(tmp, "-Users-y-other"));
    writeFileSync(join(tmp, "-Users-x-proj", "sess-1.jsonl"), "{}\n");
    writeFileSync(join(tmp, "-Users-y-other", "sess-2.jsonl"), "{}\n");
    writeFileSync(join(tmp, "-Users-x-proj", "notes.txt"), "ignore me");
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("returns one entry per .jsonl file with project metadata", () => {
    const entries = walkProjects(tmp);
    const sorted = entries.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    expect(sorted).toHaveLength(2);
    expect(sorted[0]!.sessionId).toBe("sess-1");
    expect(sorted[0]!.projectDir).toBe("/Users/x/proj");
    expect(sorted[0]!.projectLabel).toBe("x/proj");
    expect(sorted[0]!.filePath).toContain("sess-1.jsonl");
    expect(sorted[0]!.fileSize).toBeGreaterThan(0);
    expect(sorted[0]!.fileMtime).toBeGreaterThan(0);
  });

  it("ignores non-.jsonl files", () => {
    const entries = walkProjects(tmp);
    expect(entries.every((e) => e.filePath.endsWith(".jsonl"))).toBe(true);
  });

  it("returns empty array if base dir does not exist", () => {
    expect(walkProjects(join(tmp, "nope"))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- tests/indexer.test.ts
```

Expected: FAIL — `../src/indexer/walk.js` not found.

- [ ] **Step 4: Write `src/indexer/walk.ts`**

```ts
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { decodeProjectDir, projectLabel } from "../paths.js";

export type WalkEntry = {
  sessionId: string;
  projectDir: string;     // decoded real path
  projectLabel: string;
  filePath: string;       // absolute
  fileMtime: number;      // ms
  fileSize: number;
};

export function walkProjects(baseDir: string): WalkEntry[] {
  if (!existsSync(baseDir)) return [];
  const out: WalkEntry[] = [];
  for (const encoded of readdirSync(baseDir)) {
    const projDir = join(baseDir, encoded);
    let projStat;
    try { projStat = statSync(projDir); } catch { continue; }
    if (!projStat.isDirectory()) continue;
    const realPath = decodeProjectDir(encoded);
    const label = projectLabel(realPath);
    for (const name of readdirSync(projDir)) {
      if (extname(name) !== ".jsonl") continue;
      const filePath = join(projDir, name);
      let st;
      try { st = statSync(filePath); } catch { continue; }
      if (!st.isFile()) continue;
      out.push({
        sessionId: basename(name, ".jsonl"),
        projectDir: realPath,
        projectLabel: label,
        filePath,
        fileMtime: Math.floor(st.mtimeMs),
        fileSize: st.size,
      });
    }
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- tests/indexer.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/indexer/walk.ts tests/indexer.test.ts tests/fixtures/projects/basic/session-aaa.jsonl
git commit -m "feat(indexer): walk ~/.claude/projects/ and emit per-file metadata"
```

---

### Task C2: JSONL streaming parser

**Files:**
- Create: `src/indexer/parse.ts`
- Create: `tests/fixtures/projects/malformed/session-ddd.jsonl`
- Modify: `tests/indexer.test.ts`

- [ ] **Step 1: Create malformed fixture**

`tests/fixtures/projects/malformed/session-ddd.jsonl`:

```
{"type":"user","sessionId":"ddd","message":{"role":"user","content":"line 1"}}
this is not json
{"type":"assistant","sessionId":"ddd","message":{"role":"assistant","content":[{"type":"text","text":"line 3"}]}}
```

- [ ] **Step 2: Add failing test**

```ts
import { parseJsonlFile } from "../src/indexer/parse.js";

describe("indexer/parse", () => {
  it("yields one parsed RawMessage per valid line, with 1-based lineNo", async () => {
    const fixture = "tests/fixtures/projects/basic/session-aaa.jsonl";
    const out: Array<{ lineNo: number; raw: unknown; rawJson: string }> = [];
    for await (const item of parseJsonlFile(fixture)) {
      out.push(item);
    }
    expect(out).toHaveLength(2);
    expect(out[0]!.lineNo).toBe(1);
    expect(out[1]!.lineNo).toBe(2);
    expect((out[0]!.raw as any).type).toBe("user");
    expect(out[0]!.rawJson).toContain('"hello"');
  });

  it("skips malformed lines and reports them via the onError callback", async () => {
    const fixture = "tests/fixtures/projects/malformed/session-ddd.jsonl";
    const errors: Array<{ lineNo: number; line: string }> = [];
    const out = [];
    for await (const item of parseJsonlFile(fixture, { onError: (e) => errors.push(e) })) {
      out.push(item);
    }
    expect(out).toHaveLength(2);          // lines 1 and 3
    expect(out.map((o) => o.lineNo)).toEqual([1, 3]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.lineNo).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- tests/indexer.test.ts
```

Expected: FAIL — `../src/indexer/parse.js` not found.

- [ ] **Step 4: Write `src/indexer/parse.ts`**

```ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { RawMessage } from "../types.js";

export type ParsedLine = {
  lineNo: number;
  raw: RawMessage;
  rawJson: string;
};

export type ParseOptions = {
  onError?: (err: { lineNo: number; line: string; error: unknown }) => void;
};

export async function* parseJsonlFile(
  filePath: string,
  opts: ParseOptions = {}
): AsyncGenerator<ParsedLine> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (line.trim() === "") continue;
    try {
      const raw = JSON.parse(line) as RawMessage;
      yield { lineNo, raw, rawJson: line };
    } catch (error) {
      opts.onError?.({ lineNo, line, error });
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- tests/indexer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/indexer/parse.ts tests/indexer.test.ts tests/fixtures/projects/malformed/session-ddd.jsonl
git commit -m "feat(indexer): JSONL streaming parser with malformed-line tolerance"
```

---

### Task C3: Message text extractor

**Files:**
- Create: `src/indexer/extract.ts`
- Modify: `tests/indexer.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import { extractText } from "../src/indexer/extract.js";
import type { RawMessage } from "../src/types.js";

describe("indexer/extract", () => {
  it("extracts text for a user message", () => {
    const raw: RawMessage = { type: "user", message: { role: "user", content: "hello world" } };
    expect(extractText(raw)).toBe("hello world");
  });

  it("extracts text from an assistant content array", () => {
    const raw: RawMessage = {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "hi there" }] as unknown as unknown },
    };
    expect(extractText(raw)).toBe("hi there");
  });

  it("skips tool_use entries when extracting assistant text", () => {
    const raw: RawMessage = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Read", input: { path: "/x" } },
          { type: "text", text: "after the tool" },
        ] as unknown as unknown,
      },
    };
    expect(extractText(raw)).toBe("after the tool");
  });

  it("returns a marker for attachment messages", () => {
    const raw = { type: "attachment", attachment: { filename: "x.png" } } as unknown as RawMessage;
    expect(extractText(raw)).toBe("[attachment: x.png]");
  });

  it("truncates tool_result content to 2000 chars", () => {
    const big = "x".repeat(3000);
    const raw: RawMessage = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: [{ type: "text", text: big }] }] as unknown as unknown,
      },
    };
    expect(extractText(raw)!.length).toBeLessThanOrEqual(2000);
  });

  it("returns null for unknown structure", () => {
    expect(extractText({ type: "queue-operation" } as RawMessage)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/indexer.test.ts
```

Expected: FAIL — `../src/indexer/extract.js` not found.

- [ ] **Step 3: Write `src/indexer/extract.ts`**

```ts
import type { RawMessage } from "../types.js";

const MAX_TOOL_RESULT_CHARS = 2000;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; name?: string; input?: unknown }
  | { type: "tool_result"; content?: ContentPart[] | string }
  | { type: "image" | string; [k: string]: unknown };

function isPartArray(value: unknown): value is ContentPart[] {
  return Array.isArray(value);
}

function extractFromParts(parts: ContentPart[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === "text" && typeof (p as { text?: unknown }).text === "string") {
      out.push((p as { text: string }).text);
    } else if (p.type === "tool_result") {
      const c = (p as { content?: ContentPart[] | string }).content;
      let text = "";
      if (typeof c === "string") text = c;
      else if (isPartArray(c)) text = extractFromParts(c);
      if (text) out.push(text.slice(0, MAX_TOOL_RESULT_CHARS));
    }
    // tool_use: intentionally skipped
  }
  return out.join("\n\n").trim();
}

export function extractText(raw: RawMessage): string | null {
  const t = raw.type;
  if (t === "attachment") {
    const filename =
      (raw as { attachment?: { filename?: string } }).attachment?.filename ?? "unknown";
    return `[attachment: ${filename}]`;
  }
  if (t === "ai-title") {
    return typeof raw.title === "string" ? raw.title : null;
  }
  const content = raw.message?.content;
  if (typeof content === "string") return content.trim() || null;
  if (isPartArray(content)) {
    const text = extractFromParts(content as ContentPart[]);
    return text || null;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/indexer.test.ts
```

Expected: PASS, all extract tests.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/extract.ts tests/indexer.test.ts
git commit -m "feat(indexer): extract clean text per message type for FTS5 indexing"
```

---

### Task C4: Session aggregator

**Files:**
- Create: `src/indexer/aggregate.ts`
- Create: `tests/fixtures/projects/compact/session-bbb.jsonl`
- Modify: `tests/indexer.test.ts`

- [ ] **Step 1: Create compact-event fixture**

`tests/fixtures/projects/compact/session-bbb.jsonl`:

```json
{"type":"user","sessionId":"bbb","timestamp":"2026-05-23T10:00:00Z","cwd":"/Users/x/proj","gitBranch":"main","message":{"role":"user","content":"first prompt"}}
{"type":"assistant","sessionId":"bbb","timestamp":"2026-05-23T10:00:05Z","message":{"role":"assistant","content":[{"type":"text","text":"thinking..."}]}}
{"type":"user","sessionId":"bbb","timestamp":"2026-05-23T10:00:10Z","message":{"role":"user","content":"more"}}
{"type":"assistant","sessionId":"bbb","timestamp":"2026-05-23T10:00:15Z","isCompactSummary":true,"message":{"role":"assistant","content":[{"type":"text","text":"compact summary"}]}}
{"type":"ai-title","sessionId":"bbb","title":"the AI title"}
```

- [ ] **Step 2: Add failing test**

```ts
import { newAggregator, finalizeAggregator } from "../src/indexer/aggregate.js";

describe("indexer/aggregate", () => {
  it("computes session aggregates from a fixture file", async () => {
    const agg = newAggregator();
    for await (const { lineNo, raw, rawJson } of parseJsonlFile("tests/fixtures/projects/compact/session-bbb.jsonl")) {
      agg.observe({ lineNo, raw, rawJson });
    }
    const result = finalizeAggregator(agg);
    expect(result.messageCount).toBe(5);
    expect(result.userMsgCount).toBe(2);
    expect(result.compactCount).toBe(1);
    expect(result.firstPrompt).toBe("first prompt");
    expect(result.aiTitle).toBe("the AI title");
    expect(result.gitBranch).toBe("main");
    expect(result.startedAt).toBeGreaterThan(0);
    expect(result.lastActivity).toBeGreaterThanOrEqual(result.startedAt!);
    expect(result.messages).toHaveLength(5);
    expect(result.messages[3]!.isCompactSummary).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- tests/indexer.test.ts
```

Expected: FAIL — `../src/indexer/aggregate.js` not found.

- [ ] **Step 4: Write `src/indexer/aggregate.ts`**

```ts
import { extractText } from "./extract.js";
import type { MessageRow, RawMessage } from "../types.js";

type Aggregator = {
  messages: MessageRow[];
  messageCount: number;
  userMsgCount: number;
  compactCount: number;
  startedAt: number | null;
  lastActivity: number | null;
  firstPrompt: string | null;
  aiTitle: string | null;
  gitBranch: string | null;
  cwd: string | null;
};

export function newAggregator(): Aggregator {
  return {
    messages: [],
    messageCount: 0,
    userMsgCount: 0,
    compactCount: 0,
    startedAt: null,
    lastActivity: null,
    firstPrompt: null,
    aiTitle: null,
    gitBranch: null,
    cwd: null,
  };
}

function parseTimestamp(ts: string | number | undefined): number | null {
  if (ts === undefined) return null;
  if (typeof ts === "number") return ts;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

export function observeInto(
  agg: Aggregator,
  args: { lineNo: number; raw: RawMessage; rawJson: string; sessionId?: string }
): void {
  const { lineNo, raw, rawJson } = args;
  const ts = parseTimestamp(raw.timestamp);
  const type = raw.type ?? "unknown";
  const role = raw.message?.role ?? null;
  const isSidechain = !!raw.isSidechain;
  const isCompactSummary = !!raw.isCompactSummary;
  const text = extractText(raw);

  agg.messageCount += 1;
  if (type === "user" && !isSidechain) agg.userMsgCount += 1;
  if (isCompactSummary) agg.compactCount += 1;

  if (ts !== null) {
    if (agg.startedAt === null || ts < agg.startedAt) agg.startedAt = ts;
    if (agg.lastActivity === null || ts > agg.lastActivity) agg.lastActivity = ts;
  }
  if (raw.gitBranch && !agg.gitBranch) agg.gitBranch = raw.gitBranch;
  if (raw.cwd && !agg.cwd) agg.cwd = raw.cwd;
  if (type === "ai-title" && typeof raw.title === "string") agg.aiTitle = raw.title;
  if (agg.firstPrompt === null && type === "user" && !isSidechain && text) {
    agg.firstPrompt = text.slice(0, 200);
  }

  agg.messages.push({
    sessionId: args.sessionId ?? raw.sessionId ?? "",
    lineNo,
    uuid: raw.uuid ?? null,
    parentUuid: raw.parentUuid ?? null,
    type,
    role,
    isSidechain,
    isCompactSummary,
    timestamp: ts,
    textContent: text,
    rawJson,
  });
}

// Convenience wrapper for tests that hand in a stream
export function observe(agg: Aggregator) {
  return (args: { lineNo: number; raw: RawMessage; rawJson: string }) => observeInto(agg, args);
}

export function finalizeAggregator(agg: Aggregator) {
  return { ...agg };
}

// Add a method-style helper used in the test
declare module "./aggregate.js" {}
```

Wait — the test calls `agg.observe(...)` as a method. Let me fix by returning a wrapper. Replace `newAggregator()` body and add an `observe` method:

```ts
export function newAggregator() {
  const state: Aggregator = {
    messages: [], messageCount: 0, userMsgCount: 0, compactCount: 0,
    startedAt: null, lastActivity: null, firstPrompt: null,
    aiTitle: null, gitBranch: null, cwd: null,
  };
  return {
    ...state,
    observe(args: { lineNo: number; raw: RawMessage; rawJson: string; sessionId?: string }) {
      observeInto(state, args);
      Object.assign(this, state);
    },
  };
}
```

(The test only inspects properties after `finalizeAggregator`, so this works; `finalizeAggregator` returns a snapshot of `state`.)

The cleaner final form of `aggregate.ts`:

```ts
import { extractText } from "./extract.js";
import type { MessageRow, RawMessage } from "../types.js";

export type AggregatorState = {
  messages: MessageRow[];
  messageCount: number;
  userMsgCount: number;
  compactCount: number;
  startedAt: number | null;
  lastActivity: number | null;
  firstPrompt: string | null;
  aiTitle: string | null;
  gitBranch: string | null;
  cwd: string | null;
};

export type Aggregator = {
  state: AggregatorState;
  observe(args: { lineNo: number; raw: RawMessage; rawJson: string; sessionId?: string }): void;
};

function parseTimestamp(ts: string | number | undefined): number | null {
  if (ts === undefined) return null;
  if (typeof ts === "number") return ts;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

export function newAggregator(): Aggregator {
  const state: AggregatorState = {
    messages: [], messageCount: 0, userMsgCount: 0, compactCount: 0,
    startedAt: null, lastActivity: null, firstPrompt: null,
    aiTitle: null, gitBranch: null, cwd: null,
  };
  return {
    state,
    observe({ lineNo, raw, rawJson, sessionId }) {
      const ts = parseTimestamp(raw.timestamp);
      const type = raw.type ?? "unknown";
      const role = raw.message?.role ?? null;
      const isSidechain = !!raw.isSidechain;
      const isCompactSummary = !!raw.isCompactSummary;
      const text = extractText(raw);

      state.messageCount += 1;
      if (type === "user" && !isSidechain) state.userMsgCount += 1;
      if (isCompactSummary) state.compactCount += 1;
      if (ts !== null) {
        if (state.startedAt === null || ts < state.startedAt) state.startedAt = ts;
        if (state.lastActivity === null || ts > state.lastActivity) state.lastActivity = ts;
      }
      if (raw.gitBranch && !state.gitBranch) state.gitBranch = raw.gitBranch;
      if (raw.cwd && !state.cwd) state.cwd = raw.cwd;
      if (type === "ai-title" && typeof raw.title === "string") state.aiTitle = raw.title;
      if (state.firstPrompt === null && type === "user" && !isSidechain && text) {
        state.firstPrompt = text.slice(0, 200);
      }

      state.messages.push({
        sessionId: sessionId ?? raw.sessionId ?? "",
        lineNo, uuid: raw.uuid ?? null, parentUuid: raw.parentUuid ?? null,
        type, role, isSidechain, isCompactSummary, timestamp: ts,
        textContent: text, rawJson,
      });
    },
  };
}

export function finalizeAggregator(agg: Aggregator): AggregatorState {
  return agg.state;
}
```

Adjust the test to use `agg.observe(...)` and pass `sessionId: 'bbb'` so the message rows carry the right id.

- [ ] **Step 5: Adjust test to pass sessionId and re-run**

Update the test loop:

```ts
for await (const { lineNo, raw, rawJson } of parseJsonlFile("tests/fixtures/projects/compact/session-bbb.jsonl")) {
  agg.observe({ lineNo, raw, rawJson, sessionId: "bbb" });
}
```

Run:

```bash
npm test -- tests/indexer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/indexer/aggregate.ts tests/indexer.test.ts tests/fixtures/projects/compact/session-bbb.jsonl
git commit -m "feat(indexer): per-session aggregator (counts, timestamps, first prompt, ai title, compacts)"
```

---

### Task C5: Index runner — orchestrate walk → parse → upsert with incremental refresh

**Files:**
- Create: `src/indexer/index-runner.ts`
- Modify: `tests/indexer.test.ts`

- [ ] **Step 1: Add failing test**

```ts
import { indexAll } from "../src/indexer/index-runner.js";

describe("indexer/index-runner", () => {
  let tmp: string;
  let claudeProjects: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-run-"));
    claudeProjects = join(tmp, "projects");
    mkdirSync(claudeProjects, { recursive: true });
    db = openDb(join(tmp, "test.db"));

    // copy fixtures into a synthetic ~/.claude/projects/
    const proj = join(claudeProjects, "-Users-x-proj");
    mkdirSync(proj);
    writeFileSync(join(proj, "aaa.jsonl"),
      `{"type":"user","sessionId":"aaa","timestamp":"2026-05-23T10:00:00Z","cwd":"/Users/x/proj","gitBranch":"main","message":{"role":"user","content":"hello"}}\n` +
      `{"type":"assistant","sessionId":"aaa","timestamp":"2026-05-23T10:00:05Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}\n`
    );
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it("indexes all sessions and stores aggregates + messages", async () => {
    const stats = await indexAll(db, { baseDir: claudeProjects });
    expect(stats.sessionsIndexed).toBe(1);
    const all = listSessions(db);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe("aaa");
    expect(all[0]!.userMsgCount).toBe(1);
    expect(getSessionMessages(db, "aaa")).toHaveLength(2);
  });

  it("skips files whose mtime+size are unchanged on second run", async () => {
    const first = await indexAll(db, { baseDir: claudeProjects });
    expect(first.sessionsIndexed).toBe(1);
    const second = await indexAll(db, { baseDir: claudeProjects });
    expect(second.sessionsIndexed).toBe(0);
    expect(second.sessionsSkipped).toBe(1);
  });

  it("re-indexes a file whose mtime has changed", async () => {
    await indexAll(db, { baseDir: claudeProjects });
    // touch the file
    const filePath = join(claudeProjects, "-Users-x-proj", "aaa.jsonl");
    const newContent = readFileSync(filePath, "utf8") +
      `{"type":"user","sessionId":"aaa","timestamp":"2026-05-23T10:01:00Z","message":{"role":"user","content":"more"}}\n`;
    writeFileSync(filePath, newContent);
    const stats = await indexAll(db, { baseDir: claudeProjects });
    expect(stats.sessionsIndexed).toBe(1);
    expect(getSessionMessages(db, "aaa")).toHaveLength(3);
  });
});
```

Don't forget to add `readFileSync` to the imports at top of the test file.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/indexer.test.ts
```

Expected: FAIL — `../src/indexer/index-runner.js` not found.

- [ ] **Step 3: Write `src/indexer/index-runner.ts`**

```ts
import type Database from "better-sqlite3";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { walkProjects } from "./walk.js";
import { parseJsonlFile } from "./parse.js";
import { newAggregator, finalizeAggregator } from "./aggregate.js";
import { getSessionByFilePath, upsertSession } from "../db/sessions.js";
import { deleteSessionMessages, insertMessages } from "../db/messages.js";
import { CLAUDE_PROJECTS_DIR, LOGS_DIR } from "../paths.js";
import type { Session } from "../types.js";

export type IndexRunOptions = {
  baseDir?: string;        // default: ~/.claude/projects
  force?: boolean;         // re-index even if mtime+size match
  onProgress?: (msg: string) => void;
};

export type IndexRunStats = {
  filesSeen: number;
  sessionsIndexed: number;
  sessionsSkipped: number;
  malformedLines: number;
  errors: number;
};

function logIndexError(line: string): void {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(join(LOGS_DIR, "index-errors.log"), line + "\n");
  } catch {
    // best-effort logging only
  }
}

export async function indexAll(
  db: Database.Database,
  opts: IndexRunOptions = {}
): Promise<IndexRunStats> {
  const baseDir = opts.baseDir ?? CLAUDE_PROJECTS_DIR;
  const stats: IndexRunStats = {
    filesSeen: 0, sessionsIndexed: 0, sessionsSkipped: 0,
    malformedLines: 0, errors: 0,
  };
  const entries = walkProjects(baseDir);
  for (const e of entries) {
    stats.filesSeen += 1;
    const existing = getSessionByFilePath(db, e.filePath);
    if (
      !opts.force &&
      existing &&
      existing.fileMtime === e.fileMtime &&
      existing.fileSize === e.fileSize
    ) {
      stats.sessionsSkipped += 1;
      continue;
    }

    const agg = newAggregator();
    try {
      for await (const item of parseJsonlFile(e.filePath, {
        onError: (err) => {
          stats.malformedLines += 1;
          logIndexError(
            `${new Date().toISOString()} ${e.filePath}:${err.lineNo} ${
              err.error instanceof Error ? err.error.message : String(err.error)
            }`
          );
        },
      })) {
        agg.observe({ ...item, sessionId: e.sessionId });
      }
    } catch (err) {
      stats.errors += 1;
      logIndexError(
        `${new Date().toISOString()} ${e.filePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    const state = finalizeAggregator(agg);
    const session: Session = {
      id: e.sessionId,
      projectDir: e.projectDir,
      projectLabel: e.projectLabel,
      filePath: e.filePath,
      fileMtime: e.fileMtime,
      fileSize: e.fileSize,
      startedAt: state.startedAt,
      lastActivity: state.lastActivity,
      gitBranch: state.gitBranch,
      messageCount: state.messageCount,
      userMsgCount: state.userMsgCount,
      compactCount: state.compactCount,
      firstPrompt: state.firstPrompt,
      aiTitle: state.aiTitle,
      indexedAt: Date.now(),
    };

    const tx = db.transaction(() => {
      upsertSession(db, session);
      deleteSessionMessages(db, e.sessionId);
      if (state.messages.length > 0) insertMessages(db, state.messages);
    });
    tx();
    stats.sessionsIndexed += 1;
    opts.onProgress?.(`indexed ${e.projectLabel}/${e.sessionId} (${state.messageCount} msgs)`);
  }
  return stats;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/indexer.test.ts
```

Expected: PASS, all 3 runner tests + earlier tests.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/index-runner.ts tests/indexer.test.ts
git commit -m "feat(indexer): incremental refresh orchestrator with mtime+size skip"
```

---

## Phase D — CLI

### Task D1: commander skeleton + bin entry

**Files:**
- Create: `src/cli/index.ts`

- [ ] **Step 1: Write `src/cli/index.ts`**

```ts
import { Command } from "commander";
import { reindexCommand } from "./reindex.js";
import { listCommand } from "./list.js";
import { searchCommand } from "./search.js";
import { doctorCommand } from "./doctor.js";

const program = new Command();
program
  .name("ccaudit")
  .description("Browse, search, and audit your Claude Code session history")
  .version("0.0.1");

program
  .command("reindex")
  .description("Rebuild the SQLite index from ~/.claude/projects/")
  .option("--force", "re-parse even if file mtime+size are unchanged")
  .action(reindexCommand);

program
  .command("list")
  .description("List indexed sessions in a table")
  .option("--project <dir>", "filter by project directory")
  .option("--limit <n>", "max rows", "30")
  .action(listCommand);

program
  .command("search <query>")
  .description("Full-text search across all indexed sessions")
  .option("--limit <n>", "max hits", "20")
  .action(searchCommand);

program
  .command("doctor")
  .description("Diagnose health of the index db and access to ~/.claude/projects/")
  .action(doctorCommand);

program.parseAsync();
```

- [ ] **Step 2: Add temporary no-op command stubs so the import resolves**

Create `src/cli/reindex.ts`, `src/cli/list.ts`, `src/cli/search.ts`, `src/cli/doctor.ts` each with:

```ts
export async function reindexCommand(): Promise<void> { console.log("(reindex stub)"); }
```

(and similarly named exports for list, search, doctor).

- [ ] **Step 3: Smoke test — verify the CLI runs**

```bash
npm run dev -- --help
```

Expected: usage output listing all four subcommands.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts src/cli/reindex.ts src/cli/list.ts src/cli/search.ts src/cli/doctor.ts
git commit -m "feat(cli): commander skeleton with subcommand stubs"
```

---

### Task D2: `ccaudit reindex`

**Files:**
- Modify: `src/cli/reindex.ts`
- Test: `tests/cli.test.ts`

- [ ] **Step 1: Write failing test `tests/cli.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

describe("cli/reindex", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-cli-"));
    const proj = join(tmp, "projects", "-Users-x-proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "sess-x.jsonl"),
      `{"type":"user","sessionId":"sess-x","timestamp":"2026-05-23T10:00:00Z","message":{"role":"user","content":"hello"}}\n`
    );
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("creates ~/.ccaudit/index.db (overridden via env) and reports indexed count", () => {
    const result = spawnSync("npx", ["tsx", "src/cli/index.ts", "reindex"], {
      env: {
        ...process.env,
        CCAUDIT_HOME: tmp,
        CCAUDIT_PROJECTS_DIR: join(tmp, "projects"),
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/indexed 1 session/i);
    expect(existsSync(join(tmp, "index.db"))).toBe(true);
  });
});
```

- [ ] **Step 2: Update `src/paths.ts` to honor env overrides**

Replace the constants with getters:

```ts
import { homedir } from "node:os";
import { join } from "node:path";

const home = () => homedir();
const ccauditHome = () => process.env.CCAUDIT_HOME || join(home(), ".ccaudit");

export const CLAUDE_PROJECTS_DIR = process.env.CCAUDIT_PROJECTS_DIR || join(home(), ".claude", "projects");
export const CCAUDIT_DIR = ccauditHome();
export const INDEX_DB_PATH = join(ccauditHome(), "index.db");
export const EXPORTS_DIR = join(ccauditHome(), "exports");
export const LOGS_DIR = join(ccauditHome(), "logs");

export function decodeProjectDir(encoded: string): string {
  return encoded.replace(/-/g, "/");
}

export function projectLabel(realPath: string): string {
  const parts = realPath.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}
```

Note: env vars are read once at module load. For tests we spawn a fresh process, so this is fine.

- [ ] **Step 3: Write `src/cli/reindex.ts`**

```ts
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { indexAll } from "../indexer/index-runner.js";
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR } from "../paths.js";

export async function reindexCommand(opts: { force?: boolean }): Promise<void> {
  const db = openDb(INDEX_DB_PATH);
  try {
    const start = Date.now();
    const stats = await indexAll(db, {
      baseDir: CLAUDE_PROJECTS_DIR,
      force: !!opts.force,
      onProgress: (msg) => process.stderr.write(kleur.dim(`  ${msg}\n`)),
    });
    const ms = Date.now() - start;
    console.log(
      `Reindex complete in ${ms}ms — indexed ${stats.sessionsIndexed} session(s), ` +
        `skipped ${stats.sessionsSkipped}, malformed lines: ${stats.malformedLines}, errors: ${stats.errors}.`
    );
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/reindex.ts src/paths.ts tests/cli.test.ts
git commit -m "feat(cli): ccaudit reindex with env-var overrides for testing"
```

---

### Task D3: `ccaudit list`

**Files:**
- Modify: `src/cli/list.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Add failing test**

```ts
describe("cli/list", () => {
  // beforeEach/afterEach same fixture as reindex test
  it("prints a table of sessions after reindex", () => {
    const env = {
      ...process.env,
      CCAUDIT_HOME: tmp,
      CCAUDIT_PROJECTS_DIR: join(tmp, "projects"),
    };
    spawnSync("npx", ["tsx", "src/cli/index.ts", "reindex"], { env, encoding: "utf8" });
    const result = spawnSync("npx", ["tsx", "src/cli/index.ts", "list"], { env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sess-x");
    expect(result.stdout).toMatch(/x\/proj/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/cli.test.ts
```

Expected: FAIL — `(list stub)` printed, no session id in output.

- [ ] **Step 3: Write `src/cli/list.ts`**

```ts
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { listSessions } from "../db/sessions.js";
import { INDEX_DB_PATH } from "../paths.js";

export async function listCommand(opts: { project?: string; limit?: string }): Promise<void> {
  const db = openDb(INDEX_DB_PATH);
  try {
    const rows = listSessions(db, {
      projectDir: opts.project,
      limit: Number(opts.limit ?? 30),
    });
    if (rows.length === 0) {
      console.log("(no sessions indexed — run `ccaudit reindex`)");
      return;
    }
    const headers = ["LAST ACTIVITY", "PROJECT", "MSGS", "COMPACTS", "SESSION", "FIRST PROMPT"];
    const dataRows = rows.map((r) => [
      r.lastActivity ? new Date(r.lastActivity).toISOString().slice(0, 19).replace("T", " ") : "—",
      r.projectLabel,
      String(r.messageCount),
      String(r.compactCount),
      r.id.slice(0, 8),
      (r.firstPrompt ?? "").replace(/\s+/g, " ").slice(0, 60),
    ]);
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...dataRows.map((row) => row[i]!.length))
    );
    const fmt = (cells: string[]) =>
      cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
    console.log(kleur.bold(fmt(headers)));
    for (const row of dataRows) console.log(fmt(row));
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/list.ts tests/cli.test.ts
git commit -m "feat(cli): ccaudit list — table output of indexed sessions"
```

---

### Task D4: `ccaudit search <query>`

**Files:**
- Modify: `src/cli/search.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Add failing test**

```ts
describe("cli/search", () => {
  it("returns hits for a query after reindex", () => {
    const env = {
      ...process.env,
      CCAUDIT_HOME: tmp,
      CCAUDIT_PROJECTS_DIR: join(tmp, "projects"),
    };
    spawnSync("npx", ["tsx", "src/cli/index.ts", "reindex"], { env, encoding: "utf8" });
    const result = spawnSync("npx", ["tsx", "src/cli/index.ts", "search", "hello"], { env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sess-x");
    expect(result.stdout).toContain("hello");
  });

  it("prints a no-results message when nothing matches", () => {
    const env = {
      ...process.env,
      CCAUDIT_HOME: tmp,
      CCAUDIT_PROJECTS_DIR: join(tmp, "projects"),
    };
    spawnSync("npx", ["tsx", "src/cli/index.ts", "reindex"], { env, encoding: "utf8" });
    const result = spawnSync("npx", ["tsx", "src/cli/index.ts", "search", "zzzzzz"], { env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/no matches/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/cli.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write `src/cli/search.ts`**

```ts
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { searchMessages } from "../db/messages.js";
import { getSession } from "../db/sessions.js";
import { INDEX_DB_PATH } from "../paths.js";

function stripMarks(snippet: string): string {
  return snippet.replace(/<\/?mark>/g, "");
}

function highlightForTerminal(snippet: string): string {
  return snippet.replace(/<mark>([^<]+)<\/mark>/g, (_, inner) => kleur.yellow().bold(inner));
}

export async function searchCommand(query: string, opts: { limit?: string }): Promise<void> {
  const db = openDb(INDEX_DB_PATH);
  try {
    const hits = searchMessages(db, query, { limit: Number(opts.limit ?? 20) });
    if (hits.length === 0) {
      console.log("(no matches)");
      return;
    }
    for (const h of hits) {
      const sess = getSession(db, h.sessionId);
      const label = sess ? `${sess.projectLabel}/${h.sessionId.slice(0, 8)}` : h.sessionId.slice(0, 8);
      console.log(kleur.bold(label) + kleur.dim(` · line ${h.lineNo}`));
      console.log("  " + highlightForTerminal(stripMarks(h.snippet) === h.snippet ? h.snippet : h.snippet));
      console.log();
    }
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/search.ts tests/cli.test.ts
git commit -m "feat(cli): ccaudit search with FTS5 + terminal highlighting"
```

---

### Task D5: `ccaudit doctor`

**Files:**
- Modify: `src/cli/doctor.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Add failing test**

```ts
describe("cli/doctor", () => {
  it("reports OK for a healthy setup", () => {
    const env = {
      ...process.env,
      CCAUDIT_HOME: tmp,
      CCAUDIT_PROJECTS_DIR: join(tmp, "projects"),
    };
    spawnSync("npx", ["tsx", "src/cli/index.ts", "reindex"], { env, encoding: "utf8" });
    const result = spawnSync("npx", ["tsx", "src/cli/index.ts", "doctor"], { env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/projects dir.*OK/i);
    expect(result.stdout).toMatch(/index db.*OK/i);
  });

  it("reports a problem when projects dir is missing", () => {
    const env = {
      ...process.env,
      CCAUDIT_HOME: tmp,
      CCAUDIT_PROJECTS_DIR: join(tmp, "does-not-exist"),
    };
    const result = spawnSync("npx", ["tsx", "src/cli/index.ts", "doctor"], { env, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/projects dir.*missing|not found|ERR/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/cli.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write `src/cli/doctor.ts`**

```ts
import { existsSync, statSync } from "node:fs";
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { CLAUDE_PROJECTS_DIR, INDEX_DB_PATH } from "../paths.js";

type Check = { name: string; ok: boolean; detail: string };

export async function doctorCommand(): Promise<void> {
  const checks: Check[] = [];

  // Projects dir
  try {
    if (!existsSync(CLAUDE_PROJECTS_DIR)) {
      checks.push({
        name: "projects dir",
        ok: false,
        detail: `not found: ${CLAUDE_PROJECTS_DIR}`,
      });
    } else {
      const st = statSync(CLAUDE_PROJECTS_DIR);
      checks.push({
        name: "projects dir",
        ok: st.isDirectory(),
        detail: st.isDirectory() ? `OK at ${CLAUDE_PROJECTS_DIR}` : "path exists but is not a directory",
      });
    }
  } catch (e) {
    checks.push({
      name: "projects dir",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // Index db
  try {
    const db = openDb(INDEX_DB_PATH);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    checks.push({ name: "index db", ok: true, detail: `OK at ${INDEX_DB_PATH} (${count} sessions)` });
    db.close();
  } catch (e) {
    checks.push({
      name: "index db",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  let anyFail = false;
  for (const c of checks) {
    const status = c.ok ? kleur.green("OK") : kleur.red("ERR");
    console.log(`  [${status}] ${c.name} — ${c.detail}`);
    if (!c.ok) anyFail = true;
  }
  if (anyFail) process.exit(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/doctor.ts tests/cli.test.ts
git commit -m "feat(cli): ccaudit doctor — diagnose projects dir and index db health"
```

---

### Task D6: Build the binary and verify end-to-end

**Files:** none new

- [ ] **Step 1: Run the build**

```bash
npm run build
```

Expected: `dist/cli/index.js` exists; no TypeScript errors.

- [ ] **Step 2: Smoke-test the built binary**

```bash
node dist/cli/index.js --help
```

Expected: same help text as `npm run dev -- --help`.

- [ ] **Step 3: Run typecheck across the whole project**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all suites PASS.

- [ ] **Step 5: Real-world smoke test against your actual `~/.claude/projects/`**

```bash
node dist/cli/index.js reindex
```

Expected: a line like `Reindex complete in NNNms — indexed XX session(s), skipped Y, ...` where XX matches roughly the number of `~/.claude/projects/*/*.jsonl` files on disk.

Then:

```bash
node dist/cli/index.js list --limit 5
node dist/cli/index.js search "ezcater"
node dist/cli/index.js doctor
```

Expected: real data from your sessions, with non-zero search hits if you've discussed ezcater.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit --allow-empty -m "chore: Plan 1 complete — Foundation CLI working end-to-end against real ~/.claude/projects/"
```

---

## Self-Review

**Spec coverage check** — Every Plan 1-scoped requirement in `docs/superpowers/specs/2026-05-23-ccaudit-design.md`:

| Spec item | Task that covers it |
|-----------|---------------------|
| Section 4 schema (sessions, messages, FTS5, tags, exports) | B1 |
| FTS5 sync triggers | B1 |
| Sessions table queries | B2 |
| Messages CRUD + FTS5 search | B3 |
| Tags add/remove/list with case-insensitive matching | B4 |
| Indexer: walk JSONL files | C1 |
| Indexer: stream parse with malformed-line tolerance | C2 |
| Indexer: clean text extraction per message type (user, assistant text, tool_result, attachment, ai-title) | C3 |
| Indexer: per-session aggregates (counts, timestamps, first_prompt, ai_title, compact_count, git_branch) | C4 |
| Indexer: incremental refresh keyed on mtime + size | C5 |
| Indexer: malformed-line logging to `~/.ccaudit/logs/index-errors.log` | C5 |
| CLI: `ccaudit reindex` | D2 |
| CLI: `ccaudit list` with `--project` filter | D3 |
| CLI: `ccaudit search <query>` | D4 |
| CLI: `ccaudit doctor` | D5 |
| Env-var override of `~/.ccaudit` and `~/.claude/projects/` for tests | D2 (paths.ts) |

Deferred to later plans (out of scope for Plan 1):
- Astro server, browser UI, message rendering → **Plan 2**
- Tag editor UI, resume modal, export-to-markdown, full server-mode CLI (`ccaudit` with no args opens browser), port handling, `--no-open` → **Plan 3**
- MCP server integration → **Plan 4**

**Type consistency check** — `Session`, `MessageRow`, `SearchHit`, and `RawMessage` are defined in `src/types.ts` (Task A2) and reused identically across `src/db/*` and `src/indexer/*`. CLI commands accept `{ force?: boolean }`, `{ project?: string; limit?: string }`, and `{ limit?: string }` shapes that match the commander options declared in `src/cli/index.ts`.

**Placeholder scan** — No "TBD", "TODO", or "add appropriate error handling" remain. The aggregate.ts task does revise mid-task; the final form is the second code block (the one that defines `Aggregator` as `{ state, observe(...) }`). All test code shows concrete assertions, not "write tests for the above".

---

## Execution Handoff

Plan complete and saved to `/Users/subhayu/Downloads/ccaudit/docs/superpowers/plans/2026-05-23-ccaudit-plan-1-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — A fresh subagent picks up each task, implementation gets reviewed before the next task starts. Fast iteration, clean context per task. Best for a foundational plan like this where each phase's correctness underpins the next.

**2. Inline Execution** — Tasks execute in this same session, batched with checkpoints for review. Less context-switching but more state to keep in mind.

**Which approach?**
