# ccaudit Plan 3 — Browser-First Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ccaudit's browser UI into a daily-driver audit tool — add search, stats dashboard, resume modal, auto-reindex on server start, and `ccaudit` auto-launch with browser open.

**Architecture:** All features layer on top of the existing Astro SSR app and SQLite index from Plans 1–2. One schema migration (add `cwd` column). No React islands — all interactivity via native HTML (`<form>`, `<dialog>`, `<details>`, inline `<script>`). Auto-reindex via Astro middleware (runs once on first request). Auto-launch via CLI default command that spawns `astro dev` + opens browser.

**Tech Stack:** Astro 5 SSR, better-sqlite3, commander, existing Plan 1–2 stack unchanged.

**Spec reference:** `docs/superpowers/specs/2026-05-27-ccaudit-plan3-browser-features.md`

**Pre-flight:**
```bash
cd /Users/subhayu/Downloads/ccaudit
git log --oneline -n 3  # should show d1deb9b (tailwind fix) at or near HEAD
npm test                 # should be 54/54
npm run typecheck        # exit 0
```

---

## File Structure

| Path | Action | Purpose |
|------|--------|---------|
| `src/types.ts` | Modify | Add `cwd: string \| null` to `Session` |
| `src/db/init.ts` | Modify | Add migration: `ALTER TABLE sessions ADD COLUMN cwd TEXT` |
| `src/db/sessions.ts` | Modify | Update `SessionRowSql`, `rowToSession`, `upsertSession` for `cwd` |
| `src/db/stats.ts` | Create | `getIndexStats()` query for dashboard |
| `src/indexer/index-runner.ts` | Modify | Pass `state.cwd` into `Session` object |
| `src/middleware.ts` | Create | Astro middleware: auto-reindex on first request |
| `src/pages/index.astro` | Modify | Add stats bar above sessions table |
| `src/pages/search.astro` | Create | Search results page |
| `src/pages/s/[id].astro` | Modify | Add anchor IDs, resume button + `<dialog>` |
| `src/pages/api/sessions/[id]/resume.ts` | Create | API: return `{ command, cwd }` JSON |
| `src/layouts/Base.astro` | Modify | Add search `<form>` in header |
| `src/cli/index.ts` | Modify | Add default serve command |
| `src/cli/serve.ts` | Create | Auto-reindex + spawn Astro + open browser |
| `tests/db.test.ts` | Modify | Update fixture + add stats/cwd tests |
| `tests/render.test.ts` | Modify | (if needed for any new helpers) |

---

## Task 1: Schema migration — add `cwd` column to sessions

**Files:**
- Modify: `src/types.ts`
- Modify: `src/db/init.ts`
- Modify: `src/db/sessions.ts`
- Modify: `src/indexer/index-runner.ts`
- Modify: `tests/db.test.ts`

- [ ] **Step 1: Add `cwd` to the `Session` type in `src/types.ts`**

After `aiTitle: string | null;`, add:

```ts
  cwd: string | null;
```

- [ ] **Step 2: Add migration to `src/db/init.ts`**

After the line `db.exec(SCHEMA);`, add:

```ts
  // Migration: add cwd column if not present (Plan 3)
  const cols = db.pragma("table_info(sessions)") as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "cwd")) {
    db.exec("ALTER TABLE sessions ADD COLUMN cwd TEXT");
  }
```

Also add `cwd` to the `CREATE TABLE sessions` in the SCHEMA string (after `ai_title TEXT,`):

```sql
  cwd             TEXT,
```

(This ensures NEW databases get the column from the schema; the ALTER handles existing ones.)

- [ ] **Step 3: Update `src/db/sessions.ts`**

Add `cwd: string;` to `SessionRowSql`.

Add `cwd: r.cwd,` to `rowToSession`.

In `upsertSession`, add `cwd` to the INSERT column list, VALUES list, and ON CONFLICT SET:

Insert column list: add `cwd` after `indexed_at`
Values list: add `@cwd` after `@indexedAt`
ON CONFLICT: add `cwd = excluded.cwd`

- [ ] **Step 4: Update `src/indexer/index-runner.ts`**

In the `const session: Session = { ... }` block, add after `indexedAt: Date.now(),`:

```ts
      cwd: state.cwd,
```

- [ ] **Step 5: Update the test fixture in `tests/db.test.ts`**

In `describe("db/sessions")`, update the `fixture()` helper to include `cwd`:

```ts
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
    cwd: "/Users/x/proj",
    indexedAt: 1100,
    ...overrides,
  });
```

Also add a test to verify cwd round-trips:

```ts
  it("stores and retrieves cwd", () => {
    upsertSession(db, fixture({ cwd: "/home/user/my-project" }));
    expect(getSession(db, "sess-1")!.cwd).toBe("/home/user/my-project");
  });
```

And update any other test fixture in db.test.ts that creates sessions (in `describe("db/messages")` and `describe("db/tags")`) — add `cwd: null` to their session objects to match the new type.

- [ ] **Step 6: Run tests and typecheck**

```bash
npm test && npm run typecheck
```

Expected: all tests pass (one new test added; existing tests updated with `cwd` field), typecheck clean.

- [ ] **Step 7: Reindex to backfill `cwd`**

```bash
node dist/index.js reindex --force
```

Wait — we need to rebuild first since we changed TS:

```bash
npm run build && node dist/index.js reindex --force
```

Expected: 99 sessions re-indexed, now with `cwd` values populated.

Verify:

```bash
node -e "const D=require('better-sqlite3');const db=new D(require('os').homedir()+'/.ccaudit/index.db',{readonly:true});console.log(db.prepare('SELECT id,cwd FROM sessions WHERE cwd IS NOT NULL LIMIT 3').all())"
```

Expected: 3 rows with real cwd paths.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/db/init.ts src/db/sessions.ts src/indexer/index-runner.ts tests/db.test.ts
git commit -m "feat(db): add cwd column to sessions with migration + reindex backfill"
```

---

## Task 2: Auto-reindex on server start (Astro middleware)

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Write `src/middleware.ts`**

```ts
import { defineMiddleware } from "astro:middleware";
import { openDb } from "./db/init.js";
import { indexAll } from "./indexer/index-runner.js";
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR } from "./paths.js";

let hasIndexed = false;

export const onRequest = defineMiddleware(async (_context, next) => {
  if (!hasIndexed) {
    hasIndexed = true;
    const db = openDb(INDEX_DB_PATH);
    try {
      const stats = await indexAll(db, { baseDir: CLAUDE_PROJECTS_DIR });
      console.log(
        `[ccaudit] Auto-reindex: ${stats.sessionsIndexed} indexed, ${stats.sessionsSkipped} skipped`
      );
    } finally {
      db.close();
    }
  }
  return next();
});
```

Astro automatically discovers `src/middleware.ts` — no config change needed.

- [ ] **Step 2: Smoke-test**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 8
# First request triggers the middleware reindex
curl -s http://127.0.0.1:4321/ > /dev/null
# Check the terminal — should see the "[ccaudit] Auto-reindex: ..." line in the server logs
kill %1
wait %1 2>/dev/null
```

Expected: server logs show `[ccaudit] Auto-reindex: 0 indexed, 99 skipped` (or similar — 0 indexed if nothing changed since the manual reindex in Task 1).

- [ ] **Step 3: Run tests**

```bash
npm test && npm run typecheck
```

Expected: all pass (middleware doesn't affect tests — it only runs in the Astro server context).

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(web): auto-reindex on first request via Astro middleware"
```

---

## Task 3: Stats dashboard on `/`

**Files:**
- Create: `src/db/stats.ts`
- Modify: `src/pages/index.astro`
- Modify: `tests/db.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/db.test.ts`, add import:

```ts
import { getIndexStats } from "../src/db/stats.js";
```

Add a new describe block:

```ts
describe("db/stats", () => {
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

  it("returns aggregate stats across all sessions", () => {
    const s = (id: string, msgs: number, compacts: number, start: number, end: number) => ({
      id, projectDir: "/p", projectLabel: "p", filePath: `/p/${id}.jsonl`,
      fileMtime: 0, fileSize: 0, startedAt: start, lastActivity: end,
      gitBranch: null, messageCount: msgs, userMsgCount: 0,
      compactCount: compacts, firstPrompt: null, aiTitle: null, cwd: null, indexedAt: 0,
    });
    upsertSession(db, s("a", 100, 0, 1000, 2000));
    upsertSession(db, s("b", 200, 2, 500, 3000));
    upsertSession(db, s("c", 50, 1, 1500, 2500));

    const stats = getIndexStats(db);
    expect(stats.totalSessions).toBe(3);
    expect(stats.totalMessages).toBe(350);
    expect(stats.sessionsWithCompacts).toBe(2);
    expect(stats.oldestSession).toBe(500);
    expect(stats.newestSession).toBe(3000);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/db.test.ts
```

Expected: FAIL — `../src/db/stats.js` not found.

- [ ] **Step 3: Write `src/db/stats.ts`**

```ts
import type Database from "better-sqlite3";

export type IndexStats = {
  totalSessions: number;
  totalMessages: number;
  sessionsWithCompacts: number;
  oldestSession: number | null;
  newestSession: number | null;
};

export function getIndexStats(db: Database.Database): IndexStats {
  const row = db
    .prepare(
      `SELECT
         COUNT(*)                                              AS totalSessions,
         COALESCE(SUM(message_count), 0)                      AS totalMessages,
         SUM(CASE WHEN compact_count > 0 THEN 1 ELSE 0 END)  AS sessionsWithCompacts,
         MIN(started_at)                                       AS oldestSession,
         MAX(last_activity)                                    AS newestSession
       FROM sessions`
    )
    .get() as IndexStats;
  return row;
}
```

- [ ] **Step 4: Run tests; verify pass**

```bash
npm test -- tests/db.test.ts
```

Expected: all db tests pass.

- [ ] **Step 5: Update `src/pages/index.astro` to show stats bar**

In the frontmatter, after `const sessions = listSessions(...)`, add:

```ts
import { getIndexStats } from "../db/stats";

// ... after opening db ...
const stats = getIndexStats(db);
```

In the template, BEFORE the `<h1>Sessions</h1>`:

```astro
<div class="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
  <div class="bg-white rounded-lg border border-slate-200 p-4 text-center">
    <div class="text-2xl font-bold text-slate-900">{stats.totalSessions}</div>
    <div class="text-xs text-slate-500 uppercase mt-1">Sessions</div>
  </div>
  <div class="bg-white rounded-lg border border-slate-200 p-4 text-center">
    <div class="text-2xl font-bold text-slate-900">{stats.totalMessages.toLocaleString()}</div>
    <div class="text-xs text-slate-500 uppercase mt-1">Messages</div>
  </div>
  <div class="bg-white rounded-lg border border-slate-200 p-4 text-center">
    <div class="text-2xl font-bold text-amber-700">{stats.sessionsWithCompacts}</div>
    <div class="text-xs text-slate-500 uppercase mt-1">With compacts</div>
  </div>
  <div class="bg-white rounded-lg border border-slate-200 p-4 text-center">
    <div class="text-sm font-mono text-slate-700">{formatTimestamp(stats.oldestSession)}</div>
    <div class="text-xs text-slate-500 uppercase mt-1">Oldest</div>
  </div>
  <div class="bg-white rounded-lg border border-slate-200 p-4 text-center">
    <div class="text-sm font-mono text-slate-700">{formatTimestamp(stats.newestSession)}</div>
    <div class="text-xs text-slate-500 uppercase mt-1">Newest</div>
  </div>
</div>
```

(Add `import { formatTimestamp } from "../lib/render";` if not already imported.)

- [ ] **Step 6: Smoke**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 6
curl -s http://127.0.0.1:4321/ | grep -E "Sessions|Messages|compacts|Oldest" | head -5
kill %1
wait %1 2>/dev/null
```

Expected: stat card labels visible in HTML.

- [ ] **Step 7: Commit**

```bash
git add src/db/stats.ts tests/db.test.ts src/pages/index.astro
git commit -m "feat(web): stats dashboard bar on / with session/message/compact counts"
```

---

## Task 4: Search page + header search box

**Files:**
- Modify: `src/layouts/Base.astro`
- Create: `src/pages/search.astro`
- Modify: `src/pages/s/[id].astro` (add anchor IDs)

- [ ] **Step 1: Add search form to `src/layouts/Base.astro` header**

In the `<header>`, after the `<nav>` element and before the closing `</div>`, add:

```astro
<form action="/search" method="get" class="flex-1 max-w-md ml-auto">
  <input
    type="search"
    name="q"
    placeholder="Search all sessions…"
    class="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
  />
</form>
```

- [ ] **Step 2: Write `src/pages/search.astro`**

```astro
---
import Base from "../layouts/Base.astro";
import { openDb } from "../db/init";
import { searchMessages } from "../db/messages";
import { getSession } from "../db/sessions";
import { INDEX_DB_PATH } from "../paths";
import { shortSessionId, formatTimestamp } from "../lib/render";
import type { Session } from "../types";

const query = Astro.url.searchParams.get("q")?.trim() ?? "";

type EnrichedHit = {
  sessionId: string;
  lineNo: number;
  snippet: string;
  rank: number;
  session: Session | null;
};

let hits: EnrichedHit[] = [];
if (query) {
  const db = openDb(INDEX_DB_PATH);
  const raw = searchMessages(db, query, { limit: 50 });
  hits = raw.map((h) => ({
    ...h,
    session: getSession(db, h.sessionId),
  }));
  db.close();
}
---
<Base title={query ? `ccaudit — search: ${query}` : "ccaudit — search"}>
  <h1 class="text-2xl font-bold mb-4">Search</h1>

  <form action="/search" method="get" class="mb-6">
    <input
      type="search"
      name="q"
      value={query}
      placeholder="Search all sessions…"
      autofocus
      class="w-full max-w-xl px-4 py-2 text-base border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    />
  </form>

  {query && hits.length === 0 && (
    <p class="text-slate-500">No matches for <strong>"{query}"</strong>.</p>
  )}

  {hits.length > 0 && (
    <div class="space-y-4">
      <p class="text-sm text-slate-500">{hits.length} result{hits.length === 1 ? "" : "s"} for <strong>"{query}"</strong></p>
      {hits.map((h) => (
        <a href={`/s/${h.sessionId}#line-${h.lineNo}`}
           class="block bg-white border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
          <div class="flex items-center gap-2 text-sm text-slate-500 mb-2">
            <span class="font-mono text-blue-700">{shortSessionId(h.sessionId)}</span>
            <span>·</span>
            <span>{h.session?.projectLabel ?? "unknown"}</span>
            <span>·</span>
            <span>line {h.lineNo}</span>
            {h.session?.lastActivity && (
              <>
                <span>·</span>
                <span>{formatTimestamp(h.session.lastActivity)}</span>
              </>
            )}
          </div>
          <div class="text-sm" set:html={h.snippet}></div>
        </a>
      ))}
    </div>
  )}

  {!query && (
    <p class="text-slate-500">Type a query to search across all 116,000+ indexed messages.</p>
  )}
</Base>
```

- [ ] **Step 3: Add anchor IDs to messages in `src/pages/s/[id].astro`**

In the `{messages.map((m) => { ... })}` block, wrap each rendered message with an anchor wrapper. The simplest approach: add an `id` attribute to a wrapper `<div>` around each message.

BEFORE the `messages.map`, wrap the entire `<div class="space-y-3">` and add the ID:

Replace the `{messages.map((m) => {` block opener with:

```astro
{messages.map((m) => (
  <div id={`line-${m.lineNo}`}>
    {(() => {
      const kind = classifyMessage(m);
      if (kind === "compact-summary") return <CompactWaypoint message={m} index={compactIndex.get(m.lineNo) ?? 0} />;
      if (kind === "sidechain") return <SidechainBlock message={m} />;
      if (kind === "user-text") return <MessageUser message={m} />;
      if (kind === "assistant-text") return <MessageAssistant message={m} />;
      if (kind === "tool-use") return <ToolUseChip message={m} />;
      if (kind === "tool-result") return <ToolResultChip message={m} />;
      if (kind === "attachment") return <AttachmentChip message={m} />;
      return (
        <div class="p-2 border border-slate-200 rounded bg-slate-50 text-xs text-slate-500 font-mono">
          line {m.lineNo} · {m.type}
        </div>
      );
    })()}
  </div>
))}
```

This wraps every rendered message in a `<div id="line-42">` etc., making search results link directly via `#line-42`.

- [ ] **Step 4: Smoke search**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 6
curl -s "http://127.0.0.1:4321/search?q=ezcater" | grep -E "result|ezcater|line " | head -5
kill %1
wait %1 2>/dev/null
```

Expected: shows result count + matched snippets with "ezcater" highlighted.

- [ ] **Step 5: Run tests + typecheck**

```bash
npm test && npm run typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/layouts/Base.astro src/pages/search.astro "src/pages/s/[id].astro"
git commit -m "feat(web): search page with FTS5 + header search box + anchor scroll targets"
```

---

## Task 5: Resume modal on session view

**Files:**
- Create: `src/pages/api/sessions/[id]/resume.ts`
- Modify: `src/pages/s/[id].astro`

- [ ] **Step 1: Write the API route `src/pages/api/sessions/[id]/resume.ts`**

```bash
mkdir -p src/pages/api/sessions/\[id\]
```

Create `/Users/subhayu/Downloads/ccaudit/src/pages/api/sessions/[id]/resume.ts`:

```ts
import type { APIRoute } from "astro";
import { openDb } from "../../../../db/init.js";
import { getSession } from "../../../../db/sessions.js";
import { INDEX_DB_PATH } from "../../../../paths.js";

export const GET: APIRoute = ({ params }) => {
  const id = params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: "missing id" }), { status: 400 });
  }
  const db = openDb(INDEX_DB_PATH);
  const session = getSession(db, id);
  db.close();
  if (!session) {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }
  const cwd = session.cwd ?? session.projectDir;
  const command = `cd ${cwd}\nclaude --resume ${session.id}`;
  return new Response(
    JSON.stringify({
      command,
      cwd,
      branch: session.gitBranch,
      lastActivity: session.lastActivity,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
```

- [ ] **Step 2: Add resume button + dialog to `src/pages/s/[id].astro`**

After the session header `<div>` (the one with the title, timestamps, etc.) and BEFORE `<div class="space-y-3">`, add:

```astro
<div class="mb-4 flex gap-3">
  <button
    id="resume-btn"
    class="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
  >
    Resume this session
  </button>
</div>

<dialog id="resume-dialog" class="rounded-xl shadow-2xl border border-slate-200 p-0 backdrop:bg-black/40 max-w-lg w-full">
  <div class="p-6">
    <h3 class="text-lg font-bold mb-4">Resume this session</h3>
    <p class="text-sm text-slate-600 mb-3">Run this in a terminal:</p>
    <pre id="resume-command" class="bg-slate-900 text-green-400 rounded-lg p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap select-all"></pre>
    <div class="text-xs text-slate-500 mt-3 space-y-1">
      <div>Working directory: <span class="font-mono">{session.cwd ?? session.projectDir}</span></div>
      {session.gitBranch && <div>Branch when last active: <span class="font-mono">{session.gitBranch}</span></div>}
      <div>Last activity: {formatTimestamp(session.lastActivity)}</div>
    </div>
    <div class="flex gap-3 mt-6">
      <button id="copy-btn" class="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
        Copy command
      </button>
      <button id="close-btn" class="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300 transition-colors">
        Cancel
      </button>
    </div>
  </div>
</dialog>

<script define:vars={{ sessionId: session.id, sessionCwd: session.cwd ?? session.projectDir }}>
  const dialog = document.getElementById('resume-dialog');
  const commandEl = document.getElementById('resume-command');
  const resumeBtn = document.getElementById('resume-btn');
  const copyBtn = document.getElementById('copy-btn');
  const closeBtn = document.getElementById('close-btn');

  const command = `cd ${sessionCwd}\nclaude --resume ${sessionId}`;
  commandEl.textContent = command;

  resumeBtn.addEventListener('click', () => dialog.showModal());
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(command).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy command'; }, 1500);
    });
  });
</script>
```

The `define:vars` directive passes server-side values into the client script safely (Astro serializes them as JSON).

- [ ] **Step 3: Smoke test**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 6
SID=$(node -e "const D=require('better-sqlite3');const db=new D(require('os').homedir()+'/.ccaudit/index.db',{readonly:true});console.log(db.prepare('SELECT id FROM sessions ORDER BY last_activity DESC LIMIT 1').get().id)")
curl -s "http://127.0.0.1:4321/api/sessions/$SID/resume" | jq .
curl -s "http://127.0.0.1:4321/s/$SID" | grep -E "resume-btn|resume-dialog|Resume" | head -3
kill %1
wait %1 2>/dev/null
```

Expected:
- API returns `{ command: "cd ... \nclaude --resume ...", cwd: "...", branch: "...", lastActivity: ... }`
- Page contains `resume-btn` button and `resume-dialog` dialog elements

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test && npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add "src/pages/api/sessions/[id]/resume.ts" "src/pages/s/[id].astro"
git commit -m "feat(web): resume modal with copyable cd + claude --resume command"
```

---

## Task 6: Auto-launch CLI (`ccaudit` no-args)

**Files:**
- Create: `src/cli/serve.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Write `src/cli/serve.ts`**

```ts
import { spawn, exec } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { indexAll } from "../indexer/index-runner.js";
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR } from "../paths.js";
import { setTimeout as wait } from "node:timers/promises";

function findProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "astro.config.mjs"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("Cannot find ccaudit project root (astro.config.mjs)");
}

export async function serveCommand(opts: { port?: string; noOpen?: boolean }): Promise<void> {
  const port = opts.port ?? "4321";
  const root = findProjectRoot();

  // 1. Auto-reindex
  console.log(kleur.dim("Indexing sessions..."));
  const db = openDb(INDEX_DB_PATH);
  try {
    const stats = await indexAll(db, { baseDir: CLAUDE_PROJECTS_DIR });
    console.log(
      kleur.dim(
        `  ${stats.sessionsIndexed} indexed, ${stats.sessionsSkipped} skipped`
      )
    );
  } finally {
    db.close();
  }

  // 2. Start Astro dev server
  console.log(kleur.dim(`Starting server on http://127.0.0.1:${port} ...`));
  const server = spawn("npx", ["astro", "dev", "--port", port, "--host", "127.0.0.1"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env },
  });

  // 3. Wait for server to be ready, then open browser
  if (!opts.noOpen && !process.env.SSH_TTY) {
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          exec(`open "${url}"`);
          break;
        }
      } catch {
        // not ready
      }
      await wait(500);
    }
  }

  // 4. Forward termination
  const cleanup = () => {
    server.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep the process alive
  await new Promise(() => {});
}
```

- [ ] **Step 2: Wire the serve command as the default action in `src/cli/index.ts`**

Replace the full file:

```ts
import { Command } from "commander";
import { reindexCommand } from "./reindex.js";
import { listCommand } from "./list.js";
import { searchCommand } from "./search.js";
import { doctorCommand } from "./doctor.js";
import { serveCommand } from "./serve.js";

const program = new Command();
program
  .name("ccaudit")
  .description("Browse, search, and audit your Claude Code session history")
  .version("0.0.1");

program
  .command("serve", { isDefault: true })
  .description("Start the browser UI (default when no subcommand given)")
  .option("--port <n>", "server port", "4321")
  .option("--no-open", "don't auto-open browser")
  .action(serveCommand);

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

Key change: `serve` command added with `{ isDefault: true }`, so `ccaudit` with no args runs `serveCommand`.

- [ ] **Step 3: Smoke test auto-launch**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run dev &
sleep 10
# Should auto-open browser. Check if server is running:
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4321
kill %1
wait %1 2>/dev/null
```

Expected: returns `200`. Browser opens to the sessions page.

- [ ] **Step 4: Rebuild the binary**

```bash
npm run build
```

Expected: `dist/index.js` created, no errors.

- [ ] **Step 5: Test the built binary**

```bash
node dist/index.js --help
```

Expected: help shows `serve` as the default command alongside `reindex`, `list`, `search`, `doctor`.

- [ ] **Step 6: Run tests + typecheck**

```bash
npm test && npm run typecheck
```

Expected: pass. (CLI tests may need adjustment if they assumed no default command — check and fix.)

- [ ] **Step 7: Commit**

```bash
git add src/cli/serve.ts src/cli/index.ts
git commit -m "feat(cli): ccaudit auto-launch — reindex + start server + open browser"
```

---

## Task 7: Playwright verification + final push

**Files:** none new — verification and ship only.

- [ ] **Step 1: Rebuild everything**

```bash
cd /Users/subhayu/Downloads/ccaudit
npm run build
npm run build:web
npm test
npm run typecheck
```

Expected: all pass.

- [ ] **Step 2: Start dev server for Playwright**

```bash
npm run astro:dev &
sleep 8
```

- [ ] **Step 3: Use the `playwright-skill` to visually audit all pages**

Invoke the playwright-skill with this directive:

1. Navigate to `http://127.0.0.1:4321/` — screenshot the stats dashboard + session list. Verify:
   - Stats bar shows 5 cards (Sessions, Messages, With compacts, Oldest, Newest)
   - Session table has styled columns with real data
   - Search box visible in header

2. Navigate to `http://127.0.0.1:4321/projects` — screenshot. Verify:
   - Projects table shows real project labels + session counts
   - Styled with white bg, rounded borders

3. Navigate to `http://127.0.0.1:4321/search?q=ezcater` — screenshot. Verify:
   - Results shown with highlighted snippets
   - Each result links to a session

4. Navigate to `http://127.0.0.1:4321/s/<first-session-id>` — screenshot. Verify:
   - Session header with title, timestamps, compact count
   - Blue "You" boxes and white "Claude" boxes
   - Tool chips (🔧) collapsed
   - Resume button visible
   - If session has compacts: amber waypoint banner

5. Click the "Resume this session" button — screenshot the modal. Verify:
   - Modal shows `cd ... && claude --resume ...` command
   - Copy button present
   - Dark terminal-like pre block

Report any visual bugs, unstyled elements, or broken layouts.

- [ ] **Step 4: Stop dev server**

```bash
kill %1
wait %1 2>/dev/null
```

- [ ] **Step 5: Fix any bugs found by Playwright**

If Playwright found visual issues, fix them. Commit fixes.

- [ ] **Step 6: Final commit + push**

```bash
git commit --allow-empty -m "chore: Plan 3 complete — browser-first features shipped"
git push origin main
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|------------------|------|
| Search page (`/search?q=...`) | Task 4 |
| Auto-launch (`ccaudit` no-args) | Task 6 |
| Stats dashboard on `/` | Task 3 |
| Resume modal | Task 5 |
| Auto-reindex on server start | Task 2 |
| Schema: add `cwd` to sessions | Task 1 |
| Playwright verification | Task 7 |

**Placeholder scan:** No TBDs, TODOs, or "add error handling" phrases. Every step has code.

**Type consistency:** `Session.cwd` is `string | null` throughout. `getIndexStats` returns `IndexStats` with 5 numeric fields. `serveCommand` takes `{ port?: string; noOpen?: boolean }` matching commander's options. `EnrichedHit` in search.astro adds `session: Session | null` to the base `SearchHit`.
