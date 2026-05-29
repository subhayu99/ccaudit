# ccaudit — Design Doc

**Date:** 2026-05-23
**Author:** Subhayu (with Claude)
**Status:** Approved — pending implementation plan

---

## 1. What we're building

`ccaudit` is a locally-installed CLI tool that opens a browser page showing all Claude Code sessions on your machine, with full uncompacted history per session, full-text search across sessions, tags/stars, resume-from-modal, and markdown export. It is read-only by default with respect to Claude Code's own files — all writes happen to an isolated `~/.ccaudit/` directory.

**Primary user intent:** "I want to audit my conversations with Claude — find what I worked on, see the unbroken history of long sessions where /compact happened multiple times, and easily resume past sessions."

**v1 scope (locked):** browse + search + resume + tag/star + export-to-markdown.
**Out of scope for v1:** MCP server, smart-resume recommendations, file watchers, cross-machine sync, public sharing.

---

## 2. Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool name | `ccaudit` | `claude-history` is the deprecated name of an unrelated tool (renamed to `cchistory`); chose a fresh namespace. |
| Stack | Astro SSR with the Node adapter | Server-rendered HTML by default with React islands for interactive bits; one process, one language, native Node `fs` access to `~/.claude/projects/`. |
| Data layer | SQLite + FTS5 (`better-sqlite3`) | Sub-50ms searches across thousands of sessions; persistent across runs; built-in full-text search; one place for tags and exports too. |
| Index location | `~/.ccaudit/index.db` | Never write to `~/.claude/`; protects against upstream changes to Claude's storage format. JSONL files remain the source of truth — index is rebuildable cache. |
| Index refresh | Incremental on every launch, keyed on file mtime + size | Subsecond if nothing changed; `ccaudit reindex` for a full rebuild. |
| Resume mechanism | Modal showing `cd ... && claude --resume <id>` + copy button | Bulletproof, cross-platform, no shell-out; `cd` prefix makes the paste one-shot. |
| /compact handling | Show ALL messages in chronological order; render `isCompactSummary: true` messages as expandable visual waypoints with numbering and timestamps | The full conversation history is intact on disk; surfacing both raw messages and compact summaries directly addresses the user's "things start to dissolve" pain point. Optional toggle to hide summaries for a raw-only view. |
| Packaging | Single npm package with module folders (not multi-package monorepo) for v1 | Less ceremony; MCP-server seam preserved by keeping `src/indexer/` self-contained for later extraction. |

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    ccaudit CLI (Node.js)                     │
│   parses subcommands │ starts Astro server │ opens browser   │
└─────────────────────────┬────────────────────────────────────┘
                          │ spawns
                          ▼
┌──────────────────────────────────────────────────────────────┐
│      Astro SSR server (Node adapter, default port 4321)      │
│ ┌─────────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│ │ Pages (SSR) │  │ API routes     │  │  React islands      │ │
│ │  /          │  │ /api/sessions  │  │  SearchBox          │ │
│ │  /s/[id]    │  │ /api/search    │  │  TagEditor          │ │
│ │  /projects  │  │ /api/tag       │  │  ResumeModal        │ │
│ │  /search    │  │ /api/export    │  │  SidechainToggle    │ │
│ │  /tags/[t]  │  │ /api/reindex   │  │                     │ │
│ └─────┬───────┘  └────────┬───────┘  └─────────────────────┘ │
│       │ reads             │ reads/writes                     │
└───────┼───────────────────┼──────────────────────────────────┘
        │                   │
        ▼                   ▼
┌──────────────────┐  ┌──────────────────────────────────────┐
│~/.claude/projects│  │ ~/.ccaudit/                          │
│   (read-only)    │  │   ├── index.db (SQLite + FTS5)       │
│                  │  │   ├── exports/                       │
│                  │  │   └── logs/                          │
└──────────────────┘  └──────────────────────────────────────┘
```

### Module boundaries (folders within one npm package)

| Module | Purpose | Tests in isolation? |
|--------|---------|---------------------|
| `src/cli/` | Argument parsing (`commander`), server lifecycle, browser launch | Yes — spawn with fixture `~/.claude/projects/`. |
| `src/indexer/` | Walk JSONL files, parse incrementally, write to SQLite | Yes — give it a temp dir + temp db. |
| `src/db/` | Schema, prepared statements, FTS5 sync triggers, query helpers | Yes — pure SQL functions. |
| `src/pages/` | Astro SSR routes + API endpoints | Integration tests against in-memory db. |
| `src/components/` | React islands | Component tests with vitest. |

When MCP integration arrives, `src/indexer/` and `src/db/` lift out into a sibling package; everything in this design supports that move without rework.

---

## 4. Data layer

### SQLite schema (`~/.ccaudit/index.db`)

```sql
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,           -- session UUID from filename
  project_dir     TEXT NOT NULL,              -- decoded from ~/.claude/projects/<dir>/
  project_label   TEXT NOT NULL,              -- short human label (last 2 path segments)
  file_path       TEXT NOT NULL,              -- absolute path to the .jsonl
  file_mtime      INTEGER NOT NULL,           -- ms since epoch
  file_size       INTEGER NOT NULL,
  started_at      INTEGER,                    -- ts of first user message
  last_activity   INTEGER,                    -- ts of last message
  git_branch      TEXT,
  message_count   INTEGER NOT NULL DEFAULT 0,
  user_msg_count  INTEGER NOT NULL DEFAULT 0,
  compact_count   INTEGER NOT NULL DEFAULT 0,
  first_prompt    TEXT,                       -- first 200 chars of first user message
  ai_title        TEXT,                       -- .type='ai-title' value if present
  indexed_at      INTEGER NOT NULL
);
CREATE INDEX idx_sessions_last_activity ON sessions(last_activity DESC);
CREATE INDEX idx_sessions_project       ON sessions(project_dir, last_activity DESC);

CREATE TABLE messages (
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  line_no             INTEGER NOT NULL,
  uuid                TEXT,
  parent_uuid         TEXT,
  type                TEXT NOT NULL,
  role                TEXT,
  is_sidechain        INTEGER NOT NULL DEFAULT 0,
  is_compact_summary  INTEGER NOT NULL DEFAULT 0,
  timestamp           INTEGER,
  text_content        TEXT,                   -- cleaned, searchable text
  raw_json            TEXT,                   -- original JSONL line, for rendering fidelity
  PRIMARY KEY (session_id, line_no)
);
CREATE INDEX idx_messages_session ON messages(session_id, line_no);
CREATE INDEX idx_messages_compact ON messages(session_id, is_compact_summary);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  text_content,
  content='messages',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
-- FTS5 sync triggers (INSERT/DELETE/UPDATE) will be defined in init.

CREATE TABLE session_tags (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (session_id, tag)
);
CREATE INDEX idx_tags ON session_tags(tag, session_id);

CREATE TABLE session_exports (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  format      TEXT NOT NULL,
  exported_at INTEGER NOT NULL,
  out_path    TEXT NOT NULL,
  PRIMARY KEY (session_id, format, exported_at)
);
```

### Indexer algorithm

1. Walk `~/.claude/projects/*/` — enumerate every `*.jsonl` with mtime + size.
2. For each file, look up `(file_mtime, file_size)` in `sessions`. Skip if unchanged.
3. For new or changed files:
   - Stream JSONL line by line.
   - Parse each line as JSON; skip malformed lines (log to `~/.ccaudit/logs/index-errors.log`).
   - DELETE existing `messages` rows for the session, INSERT the parsed lines.
   - Track running aggregates: `message_count`, `user_msg_count`, `compact_count`, `started_at`, `last_activity`, `git_branch`, `first_prompt`, `ai_title`.
4. Upsert the `sessions` row with new aggregates + mtime + size + `indexed_at = now()`.
5. FTS5 stays in sync via the triggers defined on the `messages` table.

### Text extraction for FTS5

`text_content` is the *user-visible* content only:

- `user` → the prompt text.
- `assistant` (text portion of content array) → the markdown body, no `tool_use` JSON.
- `attachment` → `[attachment: <filename>]`.
- Tool results → first 2000 chars of the text output (keeps FTS5 lean).

The full original line lives in `raw_json` so the renderer can always recover the complete message.

---

## 5. Pages, API, interactions

### Page routes

| Route | Content |
|-------|---------|
| `/` | Session list, all sessions; sort by date/project/messages/compact-count; filter chips for starred, time windows, projects. |
| `/s/[id]` | Single session view: chronological messages, compact-event waypoints, sidechain toggle, tags, resume button, export button. |
| `/projects` | Sessions grouped by project directory; collapsible. |
| `/search?q=...` | FTS5 hits with snippet highlighting; click jumps to source session at the matching line. |
| `/tags/[tag]` | All sessions with `<tag>`. |

### API endpoints (under `/api/`)

| Method · Path | Purpose |
|---------------|---------|
| `GET    /api/sessions` | Paginated list with sort/filter query params. |
| `GET    /api/sessions/[id]/messages` | Stream messages — NDJSON for large sessions. |
| `GET    /api/search?q=...` | FTS5 query; returns session_id + line_no + snippet. |
| `POST   /api/sessions/[id]/tags` | Add tag. Body: `{tag}`. |
| `DELETE /api/sessions/[id]/tags/[tag]` | Remove tag. |
| `GET    /api/sessions/[id]/resume-command` | Returns `{ command, cwd, branch, last_activity }` for the modal. |
| `POST   /api/sessions/[id]/export` | Generate markdown, return `{ out_path }`. |
| `POST   /api/reindex` | Force full re-scan. |

### Resume modal

Click `Resume` on a session → modal opens with:

```
Run this in a terminal:

  cd <original-cwd>
  claude --resume <session-id>

[ Copy command ]   [ Cancel ]

Original working directory: <cwd>
Branch when last active:    <git_branch>
Last activity:              <last_activity>
```

The `cd` prefix is part of the copied block so paste-and-enter is a single keystroke.

### Message rendering

Per-message-type rendering:

- `user` — bordered box, dark accent, full text; code blocks via `shiki`.
- `assistant` text content — bordered box, light accent, rendered markdown.
- `assistant` tool_use → collapsed pill: `🔧 Read · path/to/file.ts:42`; click to expand to see inputs.
- `user` tool_result → collapsed pill: `← Read result · 1240 chars`; click to expand.
- `isSidechain: true` → indented + dimmed, with `[sub-agent: <desc>]` header; hidden behind per-session toggle ("Show sub-agent threads — N found").
- `isCompactSummary: true` → bordered waypoint with numbered compact-event marker and timestamp; collapsible to show the summary itself; full original messages around it remain visible.
- `attachment` → small chip: `📎 <filename> · <size>`.

### Tag editor

Persistent at bottom-right of session view:

```
Tags: [ops] [ezcater] [+]
```

Click a tag chip to remove; `+` to add. Tags are also clickable in the session list to filter. No taxonomy enforcement — freeform. Validation: tags are trimmed, non-empty, max 64 chars, case-preserved (matching is case-insensitive for filtering, case-preserving for display).

### Export to markdown

`POST /api/sessions/[id]/export` writes a file under `~/.ccaudit/exports/<project-label>-<session-id>-<yyyymmddHHMMSS>.md` with YAML frontmatter (session_id, project_dir, timestamps, message/compact counts, tags) followed by the rendered conversation. The HHMMSS suffix prevents same-day collision when a session is exported multiple times. After write, opens the file with the OS default markdown handler.

---

## 6. CLI surface

```bash
ccaudit                        # default: index incrementally, start server, open browser
ccaudit serve                  # same as above, explicit
ccaudit reindex                # full rebuild of index.db
ccaudit search <query>         # CLI search; prints hits with session IDs
ccaudit export <session-id>    # CLI markdown export
ccaudit list [--project DIR]   # CLI session list (table)
ccaudit doctor                 # diagnose: db health, project dir access, port availability

# Flags
ccaudit --port 4321            # override port (default: first free port starting at 4321)
ccaudit --no-open              # don't auto-open browser (useful headless / SSH)
ccaudit --debug                # verbose logs
```

**Server lifecycle:** foreground process; Ctrl-C to stop. No daemonization in v1.

**Browser open:** `open` on macOS, `xdg-open` on Linux, `start` on Windows; skipped if `--no-open` or `$SSH_TTY` is set.

**Port handling:** default `4321`. If taken, walk forward to the first free port and log the chosen one.

---

## 7. Packaging & installation

- Published to npm as `ccaudit`.
- `package.json` `bin` field maps `ccaudit` → `dist/cli/index.js`.
- Install: `npm install -g ccaudit` or `npx ccaudit` for one-off.
- Node 20+ (uses `node:fs/promises`, top-level await, native `fetch`).

---

## 8. Testing strategy

| Layer | Approach |
|-------|----------|
| Indexer (`src/indexer/`) | Fixtures: small synthetic JSONL files covering each edge case (basic session, compact event, sidechain, attachments, malformed line). Assert SQLite rows and FTS5 results. |
| DB (`src/db/`) | Pure SQL helpers tested against in-memory SQLite. |
| API routes | Integration tests with supertest against the running Astro server pointed at a fixture db. |
| CLI | Smoke tests — spawn `ccaudit list` against fixture `~/.claude/projects/`, assert stdout. |
| Browser | No automated browser tests in v1; manual verification via `playwright-skill` invocation when needed. |

---

## 9. Roadmap (deferred from v1)

| Feature | Why deferred | Revisit trigger |
|---------|--------------|-----------------|
| MCP server (search/list/get-session for other AI agents) | Tool needs real-use feedback first | After 2 weeks of personal use |
| Smart-resume — recommend a session given current `cwd` / context | Needs MCP for matching logic | After MCP lands |
| File watcher for auto-refresh as new sessions arrive | `chokidar` dep + complexity; mtime-on-launch is good enough | When manual reindex friction is felt |
| Cross-machine sync | Out of scope | If/when needed |
| Public sharing of a session | Privacy/redaction work | Possibly never |

---

## 10. Out-of-scope clarifications

- **No writes to `~/.claude/`** — under any circumstance. Source-of-truth files are read-only from `ccaudit`'s perspective.
- **No bypassing of Claude Code auth/state** — `ccaudit` reads disk artifacts only; it never talks to Anthropic APIs or modifies Claude's runtime state.
- **No automatic deletion** of session files even when "archive" or "delete session" is requested in the UI — at most, `ccaudit` can tag a session as "archived" within its own db. Original JSONLs always remain on disk.

---

## 11. Risks and how we handle them

| Risk | Mitigation |
|------|------------|
| Claude Code changes the JSONL schema in a future release | Indexer stores `raw_json` for every message; renderer is permissive about unknown fields; `ccaudit reindex` rebuilds from disk. |
| Very large session files (>50 MB) blow up memory | Indexer streams line-by-line; UI renders messages with virtualized scrolling and lazy expansion of tool_use/tool_result bodies. |
| FTS5 index drifts out of sync with `messages` | Sync triggers on the `messages` table; `ccaudit doctor` checks parity and can rebuild. |
| Port 4321 conflicts | Walk forward to next free port and log the chosen one. |
| User on a non-macOS platform | `open` falls back to `xdg-open` (Linux) / `start` (Windows); resume modal works the same everywhere since it's copy-to-clipboard. |
