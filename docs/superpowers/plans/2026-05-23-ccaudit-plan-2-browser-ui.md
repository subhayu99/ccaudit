# ccaudit Plan 2 — Browser UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Astro SSR browser UI on top of Plan 1's `~/.ccaudit/index.db` — landing on a sortable session list, drilling into a single session's full uncompacted history with proper rendering of user/assistant text, tool calls, attachments, sidechains, and `/compact` waypoints.

**Architecture:** Astro 5 in SSR mode with the Node adapter. Pages read directly from the existing SQLite index via the Plan 1 `src/db/*` modules (no new DB layer). Pure-HTML interactivity via `<details>` elements — no JS islands in Plan 2 (Plan 3 adds React islands for genuinely dynamic bits). Markdown rendering via `marked` + `shiki` for syntax highlighting. Tailwind via CDN for v1 styling (production hardening is Plan 3).

**Tech Stack:** Astro 5, `@astrojs/node`, `marked`, `shiki`, Tailwind (CDN), plus the existing Node 20+/TS 5.6+/better-sqlite3 stack from Plan 1.

**Spec reference:** `docs/superpowers/specs/2026-05-23-ccaudit-design.md` — Section 5 (Pages, API, interactions) and the message rendering rules.

**Pre-flight check before starting:** Verify Plan 1 is complete on disk:
```bash
cd /Users/subhayu/Downloads/ccaudit
git log --oneline | head -3
# should show 765e412 (bin fix) → 9e665ea (Plan 1 complete marker) → 766739e (doctor)
node dist/index.js list --limit 3
# should show 3 real sessions from your ~/.ccaudit/index.db
npm test
# should report 35/35
```

If any of those fail, stop and fix Plan 1 first.

---

## Phase A — Astro SSR scaffolding

### Task A1: Install Astro + dependencies, write `astro.config.mjs`

**Files:**
- Modify: `package.json` (add deps + scripts)
- Create: `astro.config.mjs`

- [ ] **Step 1: Install Astro and supporting deps**

```bash
cd /Users/subhayu/Downloads/ccaudit
npm install astro@^5.0.0 @astrojs/node@^9.0.0 marked@^14.1.3 shiki@^1.22.0
```

Expected: dependencies added under `dependencies` in package.json. No peer-dep errors that block install. (Astro 5 + Node adapter 9 is the matching pair.)

- [ ] **Step 2: Add Astro scripts to `package.json`**

Edit `scripts` in `/Users/subhayu/Downloads/ccaudit/package.json` from:

```json
"scripts": {
  "build": "tsup",
  "dev": "tsx src/cli/index.ts",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
},
```

To:

```json
"scripts": {
  "build": "tsup",
  "build:web": "astro build",
  "dev": "tsx src/cli/index.ts",
  "astro:dev": "astro dev --port 4321",
  "astro:preview": "astro preview --port 4321",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "astro check && tsc --noEmit"
},
```

(The new `astro check` step runs Astro's own type-check on `.astro` files — separate from `tsc` which handles `.ts`.)

- [ ] **Step 3: Write `astro.config.mjs`**

Create `/Users/subhayu/Downloads/ccaudit/astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { port: 4321, host: "127.0.0.1" },
  vite: {
    ssr: {
      // better-sqlite3 is a native module — exclude from SSR bundle
      external: ["better-sqlite3"],
    },
  },
});
```

The `vite.ssr.external` line is load-bearing: native modules MUST be marked external or Astro's SSR bundler tries to inline them and fails with a `binding.node not found` error.

- [ ] **Step 4: Update `tsconfig.json` to extend Astro's strict preset**

Edit `tsconfig.json`. Change the top of the file from:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    ...
```

To:

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "target": "ES2022",
    ...
```

Keep all existing `compilerOptions` fields. The Astro preset adds JSX-equivalents for `.astro` files and the `astro:` virtual modules.

- [ ] **Step 5: Verify Astro installed cleanly**

```bash
cd /Users/subhayu/Downloads/ccaudit && npx astro --version
```

Expected: prints `Astro v5.x.x`.

```bash
npm run typecheck
```

Expected: exit 0. (`astro check` may print "No errors found" or similar.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json astro.config.mjs tsconfig.json
git commit -m "feat(web): install Astro 5 SSR + Node adapter + markdown deps"
```

---

### Task A2: Base layout + minimal Hello page

**Files:**
- Create: `src/layouts/Base.astro`
- Create: `src/pages/index.astro`
- Create: `public/favicon.svg`

- [ ] **Step 1: Write `src/layouts/Base.astro`**

```astro
---
interface Props {
  title?: string;
}
const { title = "ccaudit" } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <script src="https://cdn.tailwindcss.com"></script>
    <style is:global>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
      pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    </style>
  </head>
  <body class="bg-slate-50 text-slate-900 min-h-screen">
    <header class="border-b border-slate-200 bg-white">
      <div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <a href="/" class="font-bold text-lg">ccaudit</a>
        <nav class="flex gap-3 text-sm text-slate-600">
          <a href="/" class="hover:text-slate-900">Sessions</a>
          <a href="/projects" class="hover:text-slate-900">Projects</a>
        </nav>
      </div>
    </header>
    <main class="max-w-6xl mx-auto px-4 py-6">
      <slot />
    </main>
  </body>
</html>
```

- [ ] **Step 2: Write a tiny placeholder `src/pages/index.astro`** (Task B1 replaces this with the real session list)

```astro
---
import Base from "../layouts/Base.astro";
---
<Base title="ccaudit — sessions">
  <h1 class="text-2xl font-bold">Sessions</h1>
  <p class="text-slate-500 mt-2">(Session list lands in Task B1.)</p>
</Base>
```

- [ ] **Step 3: Write `public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text y="13" font-size="14">📚</text></svg>
```

- [ ] **Step 4: Smoke-test the dev server**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 4
curl -s http://127.0.0.1:4321/ | head -20
kill %1
```

Expected: the curl output contains `<title>ccaudit — sessions</title>` and the placeholder paragraph. The `kill %1` stops the background dev server.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/Base.astro src/pages/index.astro public/favicon.svg
git commit -m "feat(web): base layout, header, placeholder index page"
```

---

### Task A3: Smoke test infrastructure — programmatic Astro server in tests

**Files:**
- Create: `tests/astro-smoke.test.ts`
- Create: `tests/helpers/astro-dev.ts`

- [ ] **Step 1: Write `tests/helpers/astro-dev.ts` (helper to spawn dev server)**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

export type AstroDev = {
  proc: ChildProcessWithoutNullStreams;
  url: string;
  stop: () => Promise<void>;
};

/**
 * Spawn `astro dev` on an ephemeral port and wait until it is reachable.
 * env: extra env vars (e.g. CCAUDIT_HOME to point at a test fixture).
 */
export async function startAstroDev(env: Record<string, string> = {}): Promise<AstroDev> {
  // Find a free-ish port by giving Astro one and falling back if needed.
  // For simplicity here, use 14321 (less likely to clash than 4321).
  const port = 14321 + Math.floor(Math.random() * 100);
  const proc = spawn("npx", ["astro", "dev", "--port", String(port), "--host", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const url = `http://127.0.0.1:${port}`;
  // Wait for the server to respond. Poll up to 30s.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url + "/");
      if (res.ok) {
        return {
          proc,
          url,
          stop: async () => {
            proc.kill("SIGTERM");
            await wait(200);
          },
        };
      }
    } catch {
      // not ready yet
    }
    await wait(300);
  }
  proc.kill("SIGKILL");
  throw new Error(`astro dev did not start on ${url} within 30s`);
}
```

- [ ] **Step 2: Write `tests/astro-smoke.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startAstroDev, type AstroDev } from "./helpers/astro-dev.js";

describe("astro smoke", () => {
  let dev: AstroDev;

  beforeAll(async () => {
    dev = await startAstroDev();
  }, 35_000);

  afterAll(async () => {
    await dev.stop();
  });

  it("serves the index page with the correct title", async () => {
    const res = await fetch(dev.url + "/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>ccaudit — sessions</title>");
    expect(body).toContain("Sessions");
  });
});
```

- [ ] **Step 3: Update `vitest.config.ts` to give the smoke test a longer timeout**

Replace the contents of `/Users/subhayu/Downloads/ccaudit/vitest.config.ts` with:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,  // up from 10_000 — astro-smoke can take a while to boot
    hookTimeout: 60_000,
  },
});
```

- [ ] **Step 4: Run the smoke test**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm test -- tests/astro-smoke.test.ts
```

Expected: PASS. (May take 30–60s for the first run because `astro dev` spawns and bundles.)

- [ ] **Step 5: Run the full suite to confirm no regressions**

```bash
npm test
```

Expected: 36/36 pass (35 from Plan 1 + 1 new smoke).

- [ ] **Step 6: Commit**

```bash
git add tests/astro-smoke.test.ts tests/helpers/astro-dev.ts vitest.config.ts
git commit -m "test(web): astro-dev helper + smoke test for index page"
```

---

## Phase B — Session list and projects pages

### Task B1: Real session list at `/`

**Files:**
- Create: `src/lib/render.ts`
- Create: `src/components/SessionRow.astro`
- Modify: `src/pages/index.astro` (replace placeholder)
- Test: `tests/render.test.ts`

- [ ] **Step 1: Write failing test for `src/lib/render.ts`**

Create `/Users/subhayu/Downloads/ccaudit/tests/render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatTimestamp, truncate, shortSessionId } from "../src/lib/render.js";

describe("lib/render", () => {
  it("formatTimestamp returns a readable string", () => {
    // 2026-05-23T10:00:00Z in ms = 1779862400000
    expect(formatTimestamp(1779862400000)).toMatch(/2026-05-23 \d{2}:\d{2}/);
  });

  it("formatTimestamp returns em dash for null", () => {
    expect(formatTimestamp(null)).toBe("—");
  });

  it("truncate keeps short strings unchanged", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("truncate collapses whitespace and appends ellipsis when too long", () => {
    expect(truncate("a very\n\nlong   string here that won't fit", 12)).toBe("a very long…");
  });

  it("truncate returns '' for null/undefined", () => {
    expect(truncate(null, 10)).toBe("");
    expect(truncate(undefined, 10)).toBe("");
  });

  it("shortSessionId returns first 8 chars", () => {
    expect(shortSessionId("09a39a76-b1d4-4a22-9b9d-0b33175a09a3")).toBe("09a39a76");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/render.test.ts
```

Expected: FAIL — `../src/lib/render.js` not found.

- [ ] **Step 3: Write `src/lib/render.ts`**

```ts
export function formatTimestamp(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  const cleaned = s.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + "…";
}

export function shortSessionId(id: string): string {
  return id.slice(0, 8);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/render.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Write `src/components/SessionRow.astro`**

```astro
---
import type { Session } from "../types";
import { formatTimestamp, truncate, shortSessionId } from "../lib/render";

interface Props {
  session: Session;
}
const { session } = Astro.props;
---
<tr class="border-b border-slate-200 hover:bg-slate-100 cursor-pointer">
  <td class="px-3 py-2 whitespace-nowrap text-slate-600 text-sm">
    {formatTimestamp(session.lastActivity)}
  </td>
  <td class="px-3 py-2 text-sm">
    <a href={`/s/${session.id}`} class="text-blue-700 hover:underline font-mono">
      {shortSessionId(session.id)}
    </a>
  </td>
  <td class="px-3 py-2 text-sm">{session.projectLabel}</td>
  <td class="px-3 py-2 text-right tabular-nums text-sm">{session.messageCount}</td>
  <td class="px-3 py-2 text-right tabular-nums text-sm">
    {session.compactCount > 0
      ? <span class="text-amber-700 font-semibold">{session.compactCount}</span>
      : <span class="text-slate-400">0</span>}
  </td>
  <td class="px-3 py-2 text-sm text-slate-600">
    {truncate(session.firstPrompt, 80)}
  </td>
</tr>
```

- [ ] **Step 6: Replace `src/pages/index.astro` with the real list**

```astro
---
import Base from "../layouts/Base.astro";
import SessionRow from "../components/SessionRow.astro";
import { openDb } from "../db/init";
import { listSessions } from "../db/sessions";
import { INDEX_DB_PATH } from "../paths";

const db = openDb(INDEX_DB_PATH);
const sessions = listSessions(db, { limit: 200 });
db.close();
---
<Base title="ccaudit — sessions">
  <h1 class="text-2xl font-bold mb-4">Sessions</h1>
  {sessions.length === 0 ? (
    <p class="text-slate-500">
      No sessions indexed yet. Run <code class="bg-slate-200 px-1 rounded">ccaudit reindex</code> in a terminal.
    </p>
  ) : (
    <div class="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="px-3 py-2 text-left font-medium">Last activity</th>
            <th class="px-3 py-2 text-left font-medium">Session</th>
            <th class="px-3 py-2 text-left font-medium">Project</th>
            <th class="px-3 py-2 text-right font-medium">Msgs</th>
            <th class="px-3 py-2 text-right font-medium">Compacts</th>
            <th class="px-3 py-2 text-left font-medium">First prompt</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => <SessionRow session={s} />)}
        </tbody>
      </table>
    </div>
  )}
</Base>
```

- [ ] **Step 7: Smoke-test against your real index**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 4
curl -s http://127.0.0.1:4321/ | grep -E "LoopProjects|sess|Project" | head -3
kill %1
```

Expected: matches show real project labels and session IDs from your `~/.ccaudit/index.db`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/render.ts tests/render.test.ts src/components/SessionRow.astro src/pages/index.astro
git commit -m "feat(web): real session list at / driven by SQLite index"
```

---

### Task B2: Projects page (grouped by project_dir)

**Files:**
- Create: `src/pages/projects.astro`

- [ ] **Step 1: Add a query helper to `src/db/sessions.ts`**

Append to `/Users/subhayu/Downloads/ccaudit/src/db/sessions.ts`:

```ts
export type ProjectSummary = {
  projectDir: string;
  projectLabel: string;
  sessionCount: number;
  lastActivity: number | null;
};

export function listProjects(db: Database.Database): ProjectSummary[] {
  const rows = db
    .prepare(
      `SELECT project_dir   AS projectDir,
              project_label AS projectLabel,
              COUNT(*)      AS sessionCount,
              MAX(last_activity) AS lastActivity
         FROM sessions
        GROUP BY project_dir, project_label
        ORDER BY lastActivity DESC NULLS LAST, projectLabel ASC`
    )
    .all() as ProjectSummary[];
  return rows;
}
```

- [ ] **Step 2: Add a test for `listProjects`**

Append to `/Users/subhayu/Downloads/ccaudit/tests/db.test.ts` inside the `describe("db/sessions"...)` block:

```ts
it("listProjects groups sessions by project_dir with counts and last activity", () => {
  upsertSession(db, fixture({ id: "a", projectDir: "/p1", projectLabel: "p1", lastActivity: 100 }));
  upsertSession(db, fixture({ id: "b", projectDir: "/p1", projectLabel: "p1", lastActivity: 200 }));
  upsertSession(db, fixture({ id: "c", projectDir: "/p2", projectLabel: "p2", lastActivity: 150 }));
  const projs = listProjects(db);
  expect(projs).toHaveLength(2);
  expect(projs[0]!.projectDir).toBe("/p1");
  expect(projs[0]!.sessionCount).toBe(2);
  expect(projs[0]!.lastActivity).toBe(200);
  expect(projs[1]!.projectDir).toBe("/p2");
});
```

Add `listProjects` to the existing imports at top:

```ts
import { upsertSession, getSession, listSessions, listProjects } from "../src/db/sessions.js";
```

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/db.test.ts
```

Expected: PASS, 15 db tests now (14 prior + 1 new).

- [ ] **Step 4: Write `src/pages/projects.astro`**

```astro
---
import Base from "../layouts/Base.astro";
import { openDb } from "../db/init";
import { listProjects } from "../db/sessions";
import { formatTimestamp } from "../lib/render";
import { INDEX_DB_PATH } from "../paths";

const db = openDb(INDEX_DB_PATH);
const projects = listProjects(db);
db.close();
---
<Base title="ccaudit — projects">
  <h1 class="text-2xl font-bold mb-4">Projects</h1>
  {projects.length === 0 ? (
    <p class="text-slate-500">No projects indexed yet.</p>
  ) : (
    <div class="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="px-3 py-2 text-left font-medium">Last activity</th>
            <th class="px-3 py-2 text-left font-medium">Project</th>
            <th class="px-3 py-2 text-right font-medium">Sessions</th>
            <th class="px-3 py-2 text-left font-medium">Path</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr class="border-b border-slate-200 hover:bg-slate-100">
              <td class="px-3 py-2 whitespace-nowrap text-slate-600">{formatTimestamp(p.lastActivity)}</td>
              <td class="px-3 py-2 font-semibold">{p.projectLabel}</td>
              <td class="px-3 py-2 text-right tabular-nums">{p.sessionCount}</td>
              <td class="px-3 py-2 text-slate-500 font-mono text-xs">{p.projectDir}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
</Base>
```

- [ ] **Step 5: Smoke**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 4
curl -s http://127.0.0.1:4321/projects | grep -E "LoopProjects|conductor" | head -3
kill %1
```

Expected: shows real project labels from your index.

- [ ] **Step 6: Commit**

```bash
git add src/db/sessions.ts tests/db.test.ts src/pages/projects.astro
git commit -m "feat(web): /projects page grouped by project_dir"
```

---

## Phase C — Session view page

### Task C1: `/s/[id].astro` shell + load session + messages

**Files:**
- Create: `src/pages/s/[id].astro`

- [ ] **Step 1: Write `src/pages/s/[id].astro` (basic shell, no message rendering yet — that's C2–C4)**

```astro
---
import Base from "../../layouts/Base.astro";
import { openDb } from "../../db/init";
import { getSession } from "../../db/sessions";
import { getSessionMessages } from "../../db/messages";
import { formatTimestamp, shortSessionId } from "../../lib/render";
import { INDEX_DB_PATH } from "../../paths";

const { id } = Astro.params;
if (!id) {
  return new Response("missing id", { status: 400 });
}

const db = openDb(INDEX_DB_PATH);
const session = getSession(db, id);
const messages = session ? getSessionMessages(db, id) : [];
db.close();

if (!session) {
  return new Response("session not found", { status: 404 });
}

const title = session.aiTitle ?? session.firstPrompt ?? `Session ${shortSessionId(session.id)}`;
---
<Base title={`ccaudit — ${title}`}>
  <div class="mb-6">
    <div class="text-slate-500 text-sm">
      <a href="/" class="hover:underline">← All sessions</a>
      <span class="mx-2">·</span>
      <a href={`/projects`} class="hover:underline">{session.projectLabel}</a>
    </div>
    <h1 class="text-2xl font-bold mt-2">{title}</h1>
    <div class="text-sm text-slate-500 mt-1">
      <span>{formatTimestamp(session.startedAt)} → {formatTimestamp(session.lastActivity)}</span>
      <span class="mx-2">·</span>
      <span>{session.messageCount} messages</span>
      {session.compactCount > 0 && (
        <>
          <span class="mx-2">·</span>
          <span class="text-amber-700">{session.compactCount} compact event{session.compactCount === 1 ? "" : "s"}</span>
        </>
      )}
      {session.gitBranch && (
        <>
          <span class="mx-2">·</span>
          <span class="font-mono text-xs">{session.gitBranch}</span>
        </>
      )}
    </div>
    <div class="text-xs text-slate-400 mt-1 font-mono">{session.id}</div>
  </div>

  <div class="space-y-3">
    {/* Message rendering lands in Task C2–C4 */}
    {messages.map((m) => (
      <div class="p-3 border border-slate-200 rounded-lg bg-white">
        <div class="text-xs text-slate-400 mb-1">
          line {m.lineNo} · {m.type}{m.role ? ` (${m.role})` : ""}
        </div>
        <pre class="text-sm whitespace-pre-wrap overflow-x-auto">{m.textContent ?? "(no text)"}</pre>
      </div>
    ))}
  </div>
</Base>
```

- [ ] **Step 2: Smoke test against a real session ID**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 4
# Get a real session id from the index
SID=$(node dist/index.js list --limit 1 2>/dev/null | awk 'NR==2 {print $5}')
echo "Using session: $SID"
curl -s "http://127.0.0.1:4321/s/$SID" | grep -E "Session|messages|line" | head -5
kill %1
```

Expected: HTML contains the session header and at least one `line N · type` row.

- [ ] **Step 3: Commit**

```bash
git add "src/pages/s/[id].astro"
git commit -m "feat(web): /s/[id] page shell — load session + messages from index"
```

---

### Task C2: User + Assistant text message components with markdown

**Files:**
- Create: `src/lib/markdown.ts`
- Create: `src/components/MessageUser.astro`
- Create: `src/components/MessageAssistant.astro`
- Test: `tests/markdown.test.ts`

- [ ] **Step 1: Write failing test for `src/lib/markdown.ts`**

Create `/Users/subhayu/Downloads/ccaudit/tests/markdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/lib/markdown.js";

describe("lib/markdown", () => {
  it("renders bold and italic", async () => {
    const html = await renderMarkdown("This is **bold** and *italic*.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders fenced code blocks", async () => {
    const html = await renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("const x = 1");
  });

  it("renders an empty input as empty string", async () => {
    expect(await renderMarkdown("")).toBe("");
  });

  it("renders null/undefined input as empty string", async () => {
    expect(await renderMarkdown(null)).toBe("");
    expect(await renderMarkdown(undefined)).toBe("");
  });

  it("preserves newlines via marked's gfm breaks", async () => {
    const html = await renderMarkdown("line one\nline two");
    expect(html).toMatch(/line one[\s\S]*line two/);
  });
});
```

- [ ] **Step 2: Run test; verify failure**

```bash
npm test -- tests/markdown.test.ts
```

Expected: FAIL — `../src/lib/markdown.js` not found.

- [ ] **Step 3: Write `src/lib/markdown.ts`**

```ts
import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export async function renderMarkdown(input: string | null | undefined): Promise<string> {
  if (!input) return "";
  // `marked.parse` is sync by default but the type signature is sync-or-promise.
  // Use await to handle either form safely.
  return await marked.parse(input);
}
```

(Note: we're deferring shiki syntax highlighting to Plan 3 polish. `marked` alone gives basic `<pre><code>` blocks. Plain `<pre>` is readable enough for v1.)

- [ ] **Step 4: Run test; verify pass**

```bash
npm test -- tests/markdown.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write `src/components/MessageUser.astro`**

```astro
---
import type { MessageRow } from "../types";
import { renderMarkdown } from "../lib/markdown";
import { formatTimestamp } from "../lib/render";

interface Props {
  message: MessageRow;
}
const { message } = Astro.props;
const html = await renderMarkdown(message.textContent);
---
<div class="border-l-4 border-blue-500 bg-blue-50 rounded-r-lg p-4">
  <div class="text-xs text-blue-700 font-semibold mb-2 flex justify-between">
    <span>You</span>
    <span class="text-slate-500 font-normal">{formatTimestamp(message.timestamp)}</span>
  </div>
  <div class="prose prose-sm max-w-none" set:html={html}></div>
</div>
```

- [ ] **Step 6: Write `src/components/MessageAssistant.astro`**

```astro
---
import type { MessageRow } from "../types";
import { renderMarkdown } from "../lib/markdown";
import { formatTimestamp } from "../lib/render";

interface Props {
  message: MessageRow;
}
const { message } = Astro.props;
const html = await renderMarkdown(message.textContent);
---
<div class="border-l-4 border-slate-300 bg-white rounded-r-lg p-4 border-y border-r border-slate-200">
  <div class="text-xs text-slate-600 font-semibold mb-2 flex justify-between">
    <span>Claude</span>
    <span class="text-slate-500 font-normal">{formatTimestamp(message.timestamp)}</span>
  </div>
  <div class="prose prose-sm max-w-none" set:html={html}></div>
</div>
```

- [ ] **Step 7: Update `src/pages/s/[id].astro` to use these components for user/assistant text**

Replace the `{messages.map(...)}` block with:

```astro
{messages.map((m) => {
  if (m.type === "user" && m.textContent && !m.isSidechain) {
    return <MessageUser message={m} />;
  }
  if (m.type === "assistant" && m.textContent && !m.isCompactSummary && !m.isSidechain) {
    return <MessageAssistant message={m} />;
  }
  // Other types deferred to C3/C4 — show as fallback for now.
  return (
    <div class="p-2 border border-slate-200 rounded bg-slate-50 text-xs text-slate-500 font-mono">
      line {m.lineNo} · {m.type}{m.role ? ` (${m.role})` : ""}{m.isCompactSummary ? " · COMPACT" : ""}{m.isSidechain ? " · SIDECHAIN" : ""}
      {m.textContent && <div class="mt-1">{m.textContent.slice(0, 200)}</div>}
    </div>
  );
})}
```

And add the imports at top of the page's frontmatter:

```astro
import MessageUser from "../../components/MessageUser.astro";
import MessageAssistant from "../../components/MessageAssistant.astro";
```

- [ ] **Step 8: Smoke**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 4
SID=$(node dist/index.js list --limit 1 2>/dev/null | awk 'NR==2 {print $5}')
curl -s "http://127.0.0.1:4321/s/$SID" | grep -E "You|Claude|prose" | head -5
kill %1
```

Expected: HTML contains both `You` and `Claude` labels and `prose` styling classes.

- [ ] **Step 9: Commit**

```bash
git add src/lib/markdown.ts tests/markdown.test.ts src/components/MessageUser.astro src/components/MessageAssistant.astro "src/pages/s/[id].astro"
git commit -m "feat(web): user + assistant text rendering with markdown"
```

---

### Task C3: Tool use + tool result collapsed chips

**Files:**
- Create: `src/components/ToolUseChip.astro`
- Create: `src/components/ToolResultChip.astro`
- Create: `src/components/AttachmentChip.astro`
- Modify: `src/pages/s/[id].astro`

- [ ] **Step 1: Write `src/components/ToolUseChip.astro`**

For tool_use we extract the tool name + a short input preview from `raw_json`.

```astro
---
import type { MessageRow } from "../types";

interface Props {
  message: MessageRow;
}
const { message } = Astro.props;

// Pull the first tool_use block from raw_json for header preview.
let toolName = "tool";
let inputPreview = "";
try {
  const raw = JSON.parse(message.rawJson);
  const content = raw?.message?.content;
  if (Array.isArray(content)) {
    const tu = content.find((p: { type?: string }) => p?.type === "tool_use");
    if (tu) {
      toolName = (tu as { name?: string }).name ?? "tool";
      inputPreview = JSON.stringify((tu as { input?: unknown }).input ?? {}).slice(0, 80);
    }
  }
} catch {
  // raw_json not parseable; keep defaults
}
---
<details class="border border-slate-200 rounded-lg bg-white">
  <summary class="px-3 py-2 cursor-pointer text-sm flex items-center gap-2 hover:bg-slate-50">
    <span class="font-mono text-purple-700">🔧 {toolName}</span>
    <span class="text-slate-500 truncate">{inputPreview}</span>
  </summary>
  <pre class="text-xs bg-slate-50 px-3 py-2 overflow-x-auto whitespace-pre-wrap border-t border-slate-200">{message.rawJson}</pre>
</details>
```

- [ ] **Step 2: Write `src/components/ToolResultChip.astro`**

```astro
---
import type { MessageRow } from "../types";

interface Props {
  message: MessageRow;
}
const { message } = Astro.props;
const preview = (message.textContent ?? "").slice(0, 80).replace(/\s+/g, " ");
const charCount = (message.textContent ?? "").length;
---
<details class="border border-slate-200 rounded-lg bg-white">
  <summary class="px-3 py-2 cursor-pointer text-sm flex items-center gap-2 hover:bg-slate-50">
    <span class="text-emerald-700">← tool result</span>
    <span class="text-slate-400">·</span>
    <span class="text-slate-500 truncate">{preview}</span>
    <span class="text-slate-400 text-xs ml-auto whitespace-nowrap">{charCount} chars</span>
  </summary>
  <pre class="text-xs bg-slate-50 px-3 py-2 overflow-x-auto whitespace-pre-wrap border-t border-slate-200">{message.textContent}</pre>
</details>
```

- [ ] **Step 3: Write `src/components/AttachmentChip.astro`**

```astro
---
import type { MessageRow } from "../types";

interface Props {
  message: MessageRow;
}
const { message } = Astro.props;
---
<div class="inline-flex items-center gap-2 text-sm bg-slate-100 border border-slate-200 rounded px-2 py-1 text-slate-600">
  📎 <span>{message.textContent ?? "(attachment)"}</span>
</div>
```

- [ ] **Step 4: Add a helper to detect `tool_use` vs `tool_result` from raw_json**

Create `/Users/subhayu/Downloads/ccaudit/src/lib/message-kind.ts`:

```ts
import type { MessageRow } from "../types";

export type MessageKind =
  | "user-text"
  | "assistant-text"
  | "tool-use"
  | "tool-result"
  | "attachment"
  | "compact-summary"
  | "sidechain"
  | "other";

/**
 * Classify a message based on its type + structural shape (parsed once from raw_json).
 * Order matters: compact and sidechain are flagged before content-type classification.
 */
export function classifyMessage(m: MessageRow): MessageKind {
  if (m.isCompactSummary) return "compact-summary";
  if (m.isSidechain) return "sidechain";
  if (m.type === "attachment") return "attachment";
  if (m.type === "user" || m.type === "assistant") {
    // Inspect raw_json to detect tool blocks within the user/assistant message
    try {
      const raw = JSON.parse(m.rawJson);
      const content = raw?.message?.content;
      if (Array.isArray(content)) {
        const hasToolUse = content.some((p: { type?: string }) => p?.type === "tool_use");
        const hasToolResult = content.some((p: { type?: string }) => p?.type === "tool_result");
        if (hasToolUse) return "tool-use";
        if (hasToolResult) return "tool-result";
      }
    } catch {
      // fall through
    }
    return m.type === "user" ? "user-text" : "assistant-text";
  }
  return "other";
}
```

- [ ] **Step 5: Add tests for `classifyMessage`**

Append a new describe block to `tests/render.test.ts`:

```ts
import { classifyMessage } from "../src/lib/message-kind.js";
import type { MessageRow } from "../src/types.js";

describe("lib/message-kind", () => {
  const baseRow = (overrides: Partial<MessageRow> & { rawJson?: string }): MessageRow => ({
    sessionId: "s", lineNo: 1, uuid: null, parentUuid: null,
    type: "user", role: null, isSidechain: false, isCompactSummary: false,
    timestamp: null, textContent: null, rawJson: "{}", ...overrides,
  });

  it("classifies a plain user message as user-text", () => {
    expect(classifyMessage(baseRow({
      type: "user",
      rawJson: JSON.stringify({ message: { content: "hello" } }),
    }))).toBe("user-text");
  });

  it("classifies an assistant message with tool_use as tool-use", () => {
    expect(classifyMessage(baseRow({
      type: "assistant",
      rawJson: JSON.stringify({ message: { content: [{ type: "tool_use", name: "Read" }] } }),
    }))).toBe("tool-use");
  });

  it("classifies a user message carrying tool_result as tool-result", () => {
    expect(classifyMessage(baseRow({
      type: "user",
      rawJson: JSON.stringify({ message: { content: [{ type: "tool_result", content: "" }] } }),
    }))).toBe("tool-result");
  });

  it("classifies isCompactSummary regardless of type", () => {
    expect(classifyMessage(baseRow({ type: "assistant", isCompactSummary: true }))).toBe("compact-summary");
  });

  it("classifies isSidechain regardless of type", () => {
    expect(classifyMessage(baseRow({ type: "assistant", isSidechain: true }))).toBe("sidechain");
  });

  it("classifies attachment type as attachment", () => {
    expect(classifyMessage(baseRow({ type: "attachment" }))).toBe("attachment");
  });
});
```

- [ ] **Step 6: Run tests**

```bash
npm test -- tests/render.test.ts
```

Expected: PASS, 12 tests in render.test.ts (6 prior + 6 classifyMessage).

- [ ] **Step 7: Replace the `messages.map` block in `src/pages/s/[id].astro` with kind-based dispatch**

```astro
{messages.map((m) => {
  const kind = classifyMessage(m);
  if (kind === "user-text") return <MessageUser message={m} />;
  if (kind === "assistant-text") return <MessageAssistant message={m} />;
  if (kind === "tool-use") return <ToolUseChip message={m} />;
  if (kind === "tool-result") return <ToolResultChip message={m} />;
  if (kind === "attachment") return <AttachmentChip message={m} />;
  // compact-summary and sidechain handled in C4
  return (
    <div class="p-2 border border-slate-200 rounded bg-slate-50 text-xs text-slate-500 font-mono">
      line {m.lineNo} · {m.type}{m.isCompactSummary ? " · COMPACT" : ""}{m.isSidechain ? " · SIDECHAIN" : ""}
    </div>
  );
})}
```

Add the imports at top:

```astro
import ToolUseChip from "../../components/ToolUseChip.astro";
import ToolResultChip from "../../components/ToolResultChip.astro";
import AttachmentChip from "../../components/AttachmentChip.astro";
import { classifyMessage } from "../../lib/message-kind";
```

- [ ] **Step 8: Smoke**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 4
SID=$(node dist/index.js list --limit 1 2>/dev/null | awk 'NR==2 {print $5}')
curl -s "http://127.0.0.1:4321/s/$SID" | grep -E "🔧|tool result|details" | head -5
kill %1
```

Expected: HTML contains `<details>` elements with tool name + tool result chips.

- [ ] **Step 9: Commit**

```bash
git add src/components/ToolUseChip.astro src/components/ToolResultChip.astro src/components/AttachmentChip.astro src/lib/message-kind.ts tests/render.test.ts "src/pages/s/[id].astro"
git commit -m "feat(web): tool_use/tool_result/attachment chips with classifyMessage dispatch"
```

---

### Task C4: Compact waypoints + sidechain handling

**Files:**
- Create: `src/components/CompactWaypoint.astro`
- Create: `src/components/SidechainBlock.astro`
- Modify: `src/pages/s/[id].astro`

- [ ] **Step 1: Write `src/components/CompactWaypoint.astro`**

```astro
---
import type { MessageRow } from "../types";
import { renderMarkdown } from "../lib/markdown";
import { formatTimestamp } from "../lib/render";

interface Props {
  message: MessageRow;
  index: number; // 1-based: which compact event this is
}
const { message, index } = Astro.props;
const html = await renderMarkdown(message.textContent);
---
<details class="border-2 border-amber-300 bg-amber-50 rounded-lg">
  <summary class="px-4 py-3 cursor-pointer text-sm font-semibold text-amber-900 flex items-center justify-between hover:bg-amber-100">
    <span class="flex items-center gap-2">
      🗜️ Compact event #{index}
      <span class="text-amber-700 font-normal">— Claude summarized the conversation up to this point</span>
    </span>
    <span class="text-amber-700 font-normal text-xs">{formatTimestamp(message.timestamp)}</span>
  </summary>
  <div class="px-4 py-3 border-t border-amber-200 bg-white">
    <div class="text-xs text-amber-700 mb-2 font-semibold">SUMMARY</div>
    <div class="prose prose-sm max-w-none" set:html={html}></div>
  </div>
</details>
```

- [ ] **Step 2: Write `src/components/SidechainBlock.astro`**

```astro
---
import type { MessageRow } from "../types";
import { renderMarkdown } from "../lib/markdown";
import { formatTimestamp } from "../lib/render";

interface Props {
  message: MessageRow;
}
const { message } = Astro.props;
const html = await renderMarkdown(message.textContent);
---
<div class="ml-8 border-l-2 border-dashed border-slate-300 pl-3 opacity-70">
  <div class="text-xs text-slate-500 mb-1 flex justify-between">
    <span>↪ sub-agent · {message.type}{message.role ? ` (${message.role})` : ""}</span>
    <span>{formatTimestamp(message.timestamp)}</span>
  </div>
  {message.textContent ? (
    <div class="text-sm prose prose-sm max-w-none" set:html={html}></div>
  ) : (
    <div class="text-xs text-slate-400 italic">(no text)</div>
  )}
</div>
```

- [ ] **Step 3: Update `src/pages/s/[id].astro` to handle compact + sidechain kinds**

In the page's frontmatter, compute compact-event numbering by iterating messages in order:

```astro
const compactIndex = new Map<number, number>(); // lineNo -> compact #
let compactN = 0;
for (const m of messages) {
  if (m.isCompactSummary) {
    compactN += 1;
    compactIndex.set(m.lineNo, compactN);
  }
}
```

Then replace the `messages.map` block:

```astro
{messages.map((m) => {
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
})}
```

Add the imports:

```astro
import CompactWaypoint from "../../components/CompactWaypoint.astro";
import SidechainBlock from "../../components/SidechainBlock.astro";
```

- [ ] **Step 4: Smoke against a session with compact events**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run astro:dev &
sleep 4
# Find a session with compact events (compact_count > 0)
SID=$(node -e "
  const Database = require('better-sqlite3');
  const db = new Database(require('os').homedir() + '/.ccaudit/index.db', { readonly: true });
  const row = db.prepare('SELECT id FROM sessions WHERE compact_count > 0 ORDER BY last_activity DESC LIMIT 1').get();
  console.log(row?.id ?? '');
")
echo "Session with compacts: $SID"
if [ -n "$SID" ]; then
  curl -s "http://127.0.0.1:4321/s/$SID" | grep -E "Compact event|🗜️|amber" | head -3
fi
kill %1
```

Expected: shows the compact event banner if any session has them; otherwise empty (which is fine — the smoke just confirms the page doesn't crash).

- [ ] **Step 5: Commit**

```bash
git add src/components/CompactWaypoint.astro src/components/SidechainBlock.astro "src/pages/s/[id].astro"
git commit -m "feat(web): compact waypoints + sidechain blocks in session view"
```

---

## Phase D — Verification

### Task D1: Real-world manual UI verification

**Files:** none new — this task is verification only.

- [ ] **Step 1: Build the Astro app**

```bash
cd /Users/subhayu/Downloads/ccaudit && npm run build:web
```

Expected: build completes; `dist/server/` and `dist/client/` directories exist.

- [ ] **Step 2: Run typecheck across the project (TS + Astro)**

```bash
npm run typecheck
```

Expected: exit 0. `astro check` may print summary like `0 errors, 0 warnings`.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: 38/38 PASS — 35 Plan 1 carry-over, plus 1 astro-smoke, 1 db/listProjects, and 6 message-kind tests, plus 5 markdown tests. (Adjust expected count if counts above differ by the time you reach this task.)

- [ ] **Step 4: Start dev server and walk the UI**

```bash
npm run astro:dev
```

Then in your browser, visit:

- `http://127.0.0.1:4321/` — should show the session list with real data (project labels, message counts, compact counts)
- `http://127.0.0.1:4321/projects` — should show grouped projects
- `http://127.0.0.1:4321/s/<a-real-session-id>` — should show:
  - Session header with title, timestamps, branch
  - User messages in blue-bordered boxes
  - Assistant text in white-bordered boxes
  - Tool use rendered as collapsed `<details>` chips with the tool name
  - Tool result chips with char counts
  - Compact events (if present) as amber banners with `🗜️` icon
  - Sidechain messages (if present) as dimmed/indented blocks

Spend ~5 minutes navigating real sessions. Note any visual oddities or rendering bugs but don't fix them here — file follow-ups for Plan 3 polish.

- [ ] **Step 5: Stop the dev server** (Ctrl-C in the terminal running `astro:dev`)

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "chore: Plan 2 complete — Browser UI working end-to-end against real index"
```

- [ ] **Step 7: Push to GitHub**

```bash
git push
```

Expected: pushes all Plan 2 commits to `origin/main`.

---

## Self-Review

**Spec coverage check** — Every Plan 2-scoped requirement in `docs/superpowers/specs/2026-05-23-ccaudit-design.md`:

| Spec item | Task that covers it |
|-----------|---------------------|
| Section 3 architecture: Astro SSR with Node adapter | A1 (`astro.config.mjs` with `output: "server"`, Node adapter) |
| Section 5 page `/` — session list | B1 |
| Section 5 page `/projects` — grouped by project | B2 |
| Section 5 page `/s/[id]` — single session view | C1 + C2 + C3 + C4 |
| Message rendering: user (bordered, dark accent) | C2 (`MessageUser`) |
| Message rendering: assistant text (bordered, light accent) | C2 (`MessageAssistant`) |
| Message rendering: tool_use collapsed pill | C3 (`ToolUseChip`) |
| Message rendering: tool_result collapsed pill with char count | C3 (`ToolResultChip`) |
| Message rendering: attachment chip | C3 (`AttachmentChip`) |
| Message rendering: compact event waypoints, numbered | C4 (`CompactWaypoint` with `index` prop) |
| Message rendering: sidechain indented + dimmed | C4 (`SidechainBlock`) |
| Default render order: chronological, all messages shown including compact summaries (the user's "I want the history, not just the compact part" requirement) | C4 (compact waypoints render INLINE in chronological order, not hidden) |
| Markdown rendering of message text | C2 (`renderMarkdown` via `marked`) |
| Per-session compact count in list | B1 (column shown with amber accent when > 0) |

Deferred to Plan 3:
- Search page UI (`/search?q=...`)
- Tag editor + tag filters
- Resume modal
- Markdown export from UI
- Server-startup via `ccaudit` CLI default command + browser auto-open
- Syntax highlighting via `shiki` in code blocks
- React islands

**Placeholder scan** — No "TBD", "TODO", or "add error handling" remain. Every `.astro` component has full code. Every test case has concrete assertions.

**Type consistency check** — `Session`, `MessageRow` types from Plan 1's `src/types.ts` are reused unchanged. New types: `ProjectSummary` (B2) and `MessageKind` (C3) are both defined in their introducing task. `classifyMessage` signature matches usage in `[id].astro`. `formatTimestamp(number | null)` signature matches all callers.

**Forward-compat note for Plan 3:** The `<details>` elements in tool chips and compact waypoints provide HTML-native expand/collapse with no JS. If Plan 3 wants smoother UX (animation, collapse-all-tools button, sidechain show/hide toggle), it can layer React islands on top of these same components without restructuring — `<details>` keeps working as a fallback.

---

## Execution Handoff

Plan complete and saved to `/Users/subhayu/Downloads/ccaudit/docs/superpowers/plans/2026-05-23-ccaudit-plan-2-browser-ui.md`.

**1. Subagent-Driven (recommended)** — a fresh subagent picks up each task with clean context; spec + code quality reviews per task.

**2. Inline Execution** — tasks run in this session, batched with checkpoints.

**Which approach?**
