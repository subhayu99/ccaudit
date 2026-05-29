# ccaudit Redesign — Phase 1: Warm-Obsidian Shell + Repo-First Browse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat top-nav + table UI with a warm-obsidian 3-pane shell whose left sidebar is a repo→workdir→session tree and whose middle pane is a date-grouped session list, delivering the approved browse experience end-to-end.

**Architecture:** New `AppShell.astro` layout (3-pane CSS grid, dark-first warm-obsidian tokens). Two new pure-ish read helpers in `src/db/library.ts` (`getLibraryTree`, `listSessionsGrouped`) compose the existing `computeRepoComponents`, `listWorkdirs`, sessions queries, and `exclusionCondition`. `index.astro` becomes the shell host; the reader pane shows a dashboard placeholder and links to the existing `/s/[id]` view (the reader refactor + noise cleanup is Phase 2). Interactive tree collapse is a tiny client script; everything degrades to working links without JS.

**Tech Stack:** Astro 5 SSR, better-sqlite3, Tailwind v4 (`@theme` in `global.css`), vitest, Playwright (visual verify).

**Reference:** spec `docs/superpowers/specs/2026-05-29-ccaudit-ui-redesign-design.md`; approved mockup `docs/superpowers/specs/assets/2026-05-29-ui-redesign-mockup.html`.

**Scope note:** Phase 1 = shell + sidebar + list. NOT in this plan (later phases): reader refactor, observer/command noise cleanup, ⌘K palette, graph zoom-to-fit, dashboard/analytics merge, light-theme parity polish.

---

## File Structure

- Create `src/db/library.ts` — browse reads: `getLibraryTree(db)`, `listSessionsGrouped(db, selection, nowMs)`, plus pure helper `dayBucket(ts, nowMs)`. One responsibility: shaping indexed data for the browse UI.
- Modify `src/styles/global.css` — add warm-obsidian `@theme` tokens + dark-first defaults.
- Create `src/layouts/AppShell.astro` — the 3-pane grid shell (sidebar slot is built-in; list + reader passed as slots).
- Create `src/components/Sidebar.astro` — library links + repo tree from `getLibraryTree`.
- Create `src/components/SessionListPane.astro` — date-grouped cards from `listSessionsGrouped`.
- Modify `src/pages/index.astro` — host the shell; selection via `?repo=`, `?workdir=`, `?mode=`, `?session=`.
- Modify `tests/astro-smoke.test.ts` — assert the shell renders three panes.
- Create `tests/library.test.ts` — unit tests for the two helpers + `dayBucket`.

---

## Task 1: `dayBucket` pure date-grouping helper

**Files:**
- Create: `src/db/library.ts`
- Test: `tests/library.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/library.test.ts
import { describe, it, expect } from "vitest";
import { dayBucket } from "../src/db/library.js";

// Fixed "now": 2026-05-29T12:00:00 local
const NOW = new Date(2026, 4, 29, 12, 0, 0).getTime();
const at = (y: number, mo: number, d: number) => new Date(y, mo, d, 9, 0, 0).getTime();

describe("dayBucket", () => {
  it("labels same-day as Today and previous day as Yesterday", () => {
    expect(dayBucket(at(2026, 4, 29), NOW)).toBe("Today");
    expect(dayBucket(at(2026, 4, 28), NOW)).toBe("Yesterday");
  });
  it("labels within the last 7 days as Earlier this week, older as Older", () => {
    expect(dayBucket(at(2026, 4, 25), NOW)).toBe("Earlier this week");
    expect(dayBucket(at(2026, 4, 1), NOW)).toBe("Older");
  });
  it("labels a null timestamp as Older", () => {
    expect(dayBucket(null, NOW)).toBe("Older");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/library.test.ts`
Expected: FAIL — `dayBucket` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/db/library.ts
export type DayLabel = "Today" | "Yesterday" | "Earlier this week" | "Older";

/** Bucket a timestamp into a coarse recency label relative to nowMs (local midnight math). */
export function dayBucket(ts: number | null, nowMs: number): DayLabel {
  if (ts === null) return "Older";
  const startOfDay = (m: number) => {
    const d = new Date(m);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const today = startOfDay(nowMs);
  const dayMs = 86_400_000;
  const diffDays = Math.round((today - startOfDay(ts)) / dayMs);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Earlier this week";
  return "Older";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/library.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/library.ts tests/library.test.ts
git commit -m "feat(library): dayBucket recency-grouping helper"
```

---

## Task 2: `getLibraryTree` — repo→workdir→session tree

**Files:**
- Modify: `src/db/library.ts`
- Test: `tests/library.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// add to tests/library.test.ts
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { upsertWorkdir } from "../src/db/workdirs.js";
import { addExclusion } from "../src/db/exclusions.js";
import { getLibraryTree } from "../src/db/library.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Session } from "../src/types.js";
import type { WorkdirRecord } from "../src/db/workdirs.js";

function sess(id: string, cwd: string, title: string, lastActivity = 1): Session {
  return {
    id, projectDir: cwd, projectLabel: cwd, filePath: `/p/${id}.jsonl`,
    fileMtime: 1, fileSize: 1, startedAt: 1, lastActivity, gitBranch: null,
    messageCount: 5, userMsgCount: 2, compactCount: 0, firstPrompt: title,
    aiTitle: null, cwd, indexedAt: 1,
  };
}
function wd(path: string, tokens: string[], p: Partial<WorkdirRecord> = {}): WorkdirRecord {
  return { path, kind: "git", remote: null, manifestName: null, rootCommit: null,
    existsOnDisk: true, tokens, resolvedAt: 1, ...p };
}

describe("getLibraryTree", () => {
  let tmp: string, dbPath: string;
  const setup = () => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-lib-")); dbPath = join(tmp, "t.db"); };
  const teardown = () => rmSync(tmp, { recursive: true, force: true });

  it("groups two clones into one repo with their workdirs and sessions", () => {
    setup();
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/w/delhi", ["root", "a"], { remote: "github.com/o/backend" }));
    upsertWorkdir(db, wd("/w/tianjin", ["root", "b"], { remote: "github.com/o/backend" }));
    upsertSession(db, sess("s1", "/w/delhi", "fix login"));
    upsertSession(db, sess("s2", "/w/tianjin", "add retry"));
    const tree = getLibraryTree(db);
    expect(tree.repos).toHaveLength(1);
    expect(tree.repos[0]!.displayName).toBe("backend");
    expect(tree.repos[0]!.sessionCount).toBe(2);
    expect(tree.repos[0]!.workdirs.map((w) => w.label).sort()).toEqual(["delhi", "tianjin"]);
    expect(tree.totalCount).toBe(2);
    teardown();
  });

  it("omits sessions in excluded directories", () => {
    setup();
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/w/keep", ["c1"], { remote: "github.com/o/keep" }));
    upsertWorkdir(db, wd("/obs", ["c2"]));
    upsertSession(db, sess("s1", "/w/keep", "real"));
    upsertSession(db, sess("s2", "/obs", "noise"));
    addExclusion(db, "/obs");
    const tree = getLibraryTree(db);
    expect(tree.repos.flatMap((r) => r.workdirs.map((w) => w.path))).not.toContain("/obs");
    expect(tree.totalCount).toBe(1);
    teardown();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/library.test.ts`
Expected: FAIL — `getLibraryTree` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// add to src/db/library.ts
import type Database from "better-sqlite3";
import { listWorkdirs } from "./workdirs.js";
import { computeRepoComponents } from "../identity/components.js";
import { exclusionCondition } from "./exclusions.js";
import { cleanPromptText } from "../lib/clean-prompt.js";

export type LibrarySession = {
  id: string;
  title: string;
  lastActivity: number | null;
  messageCount: number;
  compactCount: number;
  workdirPath: string;
};
export type LibraryWorkdir = {
  path: string;
  label: string;
  existsOnDisk: boolean;
  sessionCount: number;
  sessions: LibrarySession[];
};
export type LibraryRepo = {
  repoId: string;
  displayName: string;
  remote: string | null;
  workdirCount: number;
  sessionCount: number;
  workdirs: LibraryWorkdir[];
};
export type LibraryTree = { repos: LibraryRepo[]; totalCount: number };

function basename(p: string): string {
  const segs = p.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1]! : p;
}
function titleOf(aiTitle: string | null, firstPrompt: string | null, id: string): string {
  const raw = aiTitle ?? (firstPrompt ? cleanPromptText(firstPrompt) : "") ?? "";
  const t = raw.replace(/\s+/g, " ").trim();
  return t || id.slice(0, 8);
}

type LibRow = {
  id: string; cwd: string; ai_title: string | null; first_prompt: string | null;
  last_activity: number | null; message_count: number; compact_count: number;
};

export function getLibraryTree(db: Database.Database): LibraryTree {
  const workdirs = listWorkdirs(db);
  const { repos, repoByPath } = computeRepoComponents(workdirs);
  const existsByPath = new Map(workdirs.map((w) => [w.path, w.existsOnDisk]));

  const excl = exclusionCondition(db);
  const rows = db
    .prepare(
      `SELECT id, cwd, ai_title, first_prompt, last_activity AS last_activity,
              message_count AS message_count, compact_count AS compact_count
         FROM sessions
        WHERE cwd IS NOT NULL AND ${excl.sql}
        ORDER BY last_activity DESC`
    )
    .all(excl.params) as LibRow[];

  // group sessions by workdir path
  const byWorkdir = new Map<string, LibrarySession[]>();
  for (const r of rows) {
    const s: LibrarySession = {
      id: r.id, title: titleOf(r.ai_title, r.first_prompt, r.id),
      lastActivity: r.last_activity, messageCount: r.message_count,
      compactCount: r.compact_count, workdirPath: r.cwd,
    };
    byWorkdir.set(r.cwd, [...(byWorkdir.get(r.cwd) ?? []), s]);
  }

  // assemble repos from components that have ≥1 visible session
  const repoMap = new Map<string, LibraryRepo>();
  for (const r of repos) repoMap.set(r.repoId, {
    repoId: r.repoId, displayName: r.displayName, remote: r.remote,
    workdirCount: 0, sessionCount: 0, workdirs: [],
  });

  for (const [path, sessions] of byWorkdir) {
    const repoId = repoByPath.get(path);
    if (!repoId) continue;
    const repo = repoMap.get(repoId);
    if (!repo) continue;
    repo.workdirs.push({
      path, label: basename(path), existsOnDisk: existsByPath.get(path) ?? false,
      sessionCount: sessions.length, sessions,
    });
    repo.workdirCount += 1;
    repo.sessionCount += sessions.length;
  }

  const visible = [...repoMap.values()].filter((r) => r.sessionCount > 0);
  visible.forEach((r) => r.workdirs.sort((a, b) => b.sessionCount - a.sessionCount));
  visible.sort((a, b) => b.sessionCount - a.sessionCount || a.displayName.localeCompare(b.displayName));

  return { repos: visible, totalCount: rows.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/library.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/library.ts tests/library.test.ts
git commit -m "feat(library): getLibraryTree repo->workdir->session browse tree"
```

---

## Task 3: `listSessionsGrouped` — date-grouped list for a selection

**Files:**
- Modify: `src/db/library.ts`
- Test: `tests/library.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// add to tests/library.test.ts
import { listSessionsGrouped } from "../src/db/library.js";

describe("listSessionsGrouped", () => {
  const NOW2 = new Date(2026, 4, 29, 12, 0, 0).getTime();
  const day = (mo: number, d: number) => new Date(2026, mo, d, 9, 0, 0).getTime();
  let tmp2: string, dbp2: string;

  it("returns date-grouped items for a repo selection, newest group first", () => {
    tmp2 = mkdtempSync(join(tmpdir(), "ccaudit-grp-")); dbp2 = join(tmp2, "t.db");
    const db = openDb(dbp2);
    upsertWorkdir(db, wd("/w/delhi", ["root"], { remote: "github.com/o/backend" }));
    upsertSession(db, { ...sess("today", "/w/delhi", "today work", day(4, 29)) });
    upsertSession(db, { ...sess("old", "/w/delhi", "old work", day(3, 1)) });
    const repoId = getLibraryTree(db).repos[0]!.repoId;

    const res = listSessionsGrouped(db, { repo: repoId }, NOW2);
    expect(res.header.title).toBe("backend");
    expect(res.groups[0]!.label).toBe("Today");
    expect(res.groups[0]!.items[0]!.id).toBe("today");
    expect(res.groups.at(-1)!.label).toBe("Older");
    rmSync(tmp2, { recursive: true, force: true });
  });

  it("mode 'recent' returns a flat Recent group across repos", () => {
    tmp2 = mkdtempSync(join(tmpdir(), "ccaudit-grp2-")); dbp2 = join(tmp2, "t.db");
    const db = openDb(dbp2);
    upsertWorkdir(db, wd("/w/a", ["x"], { remote: "github.com/o/a" }));
    upsertSession(db, sess("s1", "/w/a", "hello", day(4, 29)));
    const res = listSessionsGrouped(db, { mode: "recent" }, NOW2);
    expect(res.header.title).toBe("Recent");
    expect(res.groups.flatMap((g) => g.items).map((i) => i.id)).toContain("s1");
    rmSync(tmp2, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/library.test.ts`
Expected: FAIL — `listSessionsGrouped` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// add to src/db/library.ts
export type Selection =
  | { repo: string }
  | { workdir: string }
  | { mode: "recent" | "all" };

export type ListItem = {
  id: string; title: string; workdirLabel: string;
  lastActivity: number | null; messageCount: number; compactCount: number;
};
export type ListGroup = { label: DayLabel | "Recent"; items: ListItem[] };
export type GroupedList = {
  header: { title: string; subtitle: string | null };
  groups: ListGroup[];
};

const DAY_ORDER: DayLabel[] = ["Today", "Yesterday", "Earlier this week", "Older"];

export function listSessionsGrouped(
  db: Database.Database,
  sel: Selection,
  nowMs: number
): GroupedList {
  const tree = getLibraryTree(db);

  // Resolve the selection to a flat list of sessions + a header.
  let items: ListItem[] = [];
  let header: { title: string; subtitle: string | null } = { title: "All sessions", subtitle: null };

  const toItem = (s: LibrarySession, workdirLabel: string): ListItem => ({
    id: s.id, title: s.title, workdirLabel,
    lastActivity: s.lastActivity, messageCount: s.messageCount, compactCount: s.compactCount,
  });

  if ("repo" in sel) {
    const repo = tree.repos.find((r) => r.repoId === sel.repo);
    if (repo) {
      header = { title: repo.displayName, subtitle: repo.remote };
      items = repo.workdirs.flatMap((w) => w.sessions.map((s) => toItem(s, w.label)));
    }
  } else if ("workdir" in sel) {
    for (const r of tree.repos) {
      const w = r.workdirs.find((x) => x.path === sel.workdir);
      if (w) { header = { title: w.label, subtitle: r.displayName }; items = w.sessions.map((s) => toItem(s, w.label)); break; }
    }
  } else {
    header = { title: sel.mode === "recent" ? "Recent" : "All sessions", subtitle: null };
    items = tree.repos.flatMap((r) => r.workdirs.flatMap((w) => w.sessions.map((s) => toItem(s, w.label))));
  }

  items.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));

  if ("mode" in sel && sel.mode === "recent") {
    return { header, groups: [{ label: "Recent", items: items.slice(0, 25) }] };
  }

  const buckets = new Map<DayLabel, ListItem[]>();
  for (const it of items) {
    const b = dayBucket(it.lastActivity, nowMs);
    buckets.set(b, [...(buckets.get(b) ?? []), it]);
  }
  const groups: ListGroup[] = DAY_ORDER
    .filter((l) => buckets.has(l))
    .map((l) => ({ label: l, items: buckets.get(l)! }));
  return { header, groups };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/library.test.ts`
Expected: PASS (all library tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/library.ts tests/library.test.ts
git commit -m "feat(library): listSessionsGrouped date-bucketed list per selection"
```

---

## Task 4: Warm-obsidian design tokens (dark-first)

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add the token layer + dark-first base**

Append to `src/styles/global.css` (after the existing `@import "tailwindcss";` / `@plugin` lines — do NOT remove them):

```css
/* --- warm-obsidian design system (dark-first) --- */
:root {
  --canvas:#1b1916; --panel:#211e19; --panel-2:#26221b; --raise:#2d2820;
  --border:#37312a; --border-soft:#2b2620;
  --text:#ece5d6; --text-dim:#a39a87; --text-faint:#6f685b;
  --amber:#d2a85f; --amber-bright:#e6bd76; --violet:#9b82d6;
  --c-green:#7fae7a; --c-orange:#cf8a4a; --c-blue:#6fa1d8;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --mono:"SF Mono",ui-monospace,"JetBrains Mono",Menlo,monospace;
}
html.theme-light {
  --canvas:#f5f1e8; --panel:#efe9dc; --panel-2:#e9e2d2; --raise:#e2dac8;
  --border:#d8cfba; --border-soft:#e2dac8;
  --text:#2c281f; --text-dim:#6b6452; --text-faint:#9a917d;
}
html, body { background:var(--canvas); color:var(--text); }
.font-serif { font-family:var(--serif); }
.font-mono-w { font-family:var(--mono); }
```

- [ ] **Step 2: Build the web bundle to confirm CSS compiles**

Run: `npm run build:web`
Expected: "Complete!" with no CSS errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(ui): warm-obsidian design tokens, dark-first"
```

---

## Task 5: `AppShell.astro` 3-pane layout

**Files:**
- Create: `src/layouts/AppShell.astro`

- [ ] **Step 1: Create the shell**

```astro
---
// src/layouts/AppShell.astro — 3-pane grid: sidebar slot + list slot + reader slot.
import "../styles/global.css";
interface Props { title?: string; }
const { title = "ccaudit" } = Astro.props;
---
<html lang="en" class="theme-dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <script is:inline>
      // dark-first; persist user choice
      const t = localStorage.getItem("ccaudit-theme");
      document.documentElement.classList.toggle("theme-light", t === "light");
    </script>
  </head>
  <body class="m-0">
    <div class="grid h-screen overflow-hidden" style="grid-template-columns: 264px 372px 1fr;">
      <aside class="overflow-y-auto" style="background:var(--panel); border-right:1px solid var(--border-soft);">
        <slot name="sidebar" />
      </aside>
      <section class="overflow-hidden flex flex-col" style="background:var(--panel-2); border-right:1px solid var(--border-soft);">
        <slot name="list" />
      </section>
      <main class="overflow-y-auto" style="background:var(--canvas);">
        <slot name="reader" />
      </main>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `npm run build:web`
Expected: "Complete!" (AppShell unused yet, but must parse).

- [ ] **Step 3: Commit**

```bash
git add src/layouts/AppShell.astro
git commit -m "feat(ui): AppShell 3-pane layout shell"
```

---

## Task 6: `Sidebar.astro` library tree

**Files:**
- Create: `src/components/Sidebar.astro`

- [ ] **Step 1: Create the sidebar**

```astro
---
// src/components/Sidebar.astro
import type { LibraryTree } from "../db/library";
interface Props { tree: LibraryTree; activeRepo?: string; activeWorkdir?: string; mode?: string; }
const { tree, activeRepo, activeWorkdir, mode } = Astro.props;
---
<div class="flex flex-col h-full" style="color:var(--text-dim);">
  <div class="flex items-center gap-2 px-4 pt-4 pb-3">
    <div class="w-[22px] h-[22px] rounded-md grid place-items-center font-bold text-[13px]"
         style="background:linear-gradient(135deg,var(--amber),var(--c-orange)); color:#241f17;">c</div>
    <h1 class="font-serif text-[18px] font-semibold" style="color:var(--text);">ccaudit</h1>
  </div>
  <a href="/search" class="mx-3 mb-3 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px]"
     style="background:var(--canvas); border:1px solid var(--border); color:var(--text-faint);">
    <span>⚲</span><span>Search history…</span>
    <span class="ml-auto font-mono-w text-[11px] px-1.5 rounded" style="background:var(--raise); border:1px solid var(--border);">⌘K</span>
  </a>
  <nav class="px-2 overflow-y-auto flex-1">
    <div class="text-[10.5px] tracking-wider uppercase px-2.5 pt-3 pb-1.5 font-semibold" style="color:var(--text-faint);">Library</div>
    <a href="/?mode=recent" class="lib-item" data-active={mode === "recent"}>◷ Recent</a>
    <a href="/?mode=all" class="lib-item" data-active={mode === "all"}>✦ All sessions <span class="ml-auto text-[11px]">{tree.totalCount}</span></a>
    <a href="/graph?view=repos" class="lib-item">⌗ Graph view</a>
    <a href="/analytics" class="lib-item">▦ Analytics</a>

    <div class="text-[10.5px] tracking-wider uppercase px-2.5 pt-3.5 pb-1.5 font-semibold" style="color:var(--text-faint);">Repositories</div>
    {tree.repos.map((repo) => (
      <div class="repo-group" data-open={repo.repoId === activeRepo}>
        <a href={`/?repo=${encodeURIComponent(repo.repoId)}`} class="lib-item" data-active={repo.repoId === activeRepo}>
          <button class="caret" aria-label="toggle">›</button>
          <span class="w-2 h-2 rounded-full" style="background:var(--c-green);"></span>
          <span class="truncate">{repo.displayName}</span>
          <span class="ml-auto text-[11px]">{repo.sessionCount}</span>
        </a>
        <div class="children">
          {repo.workdirs.map((w) => (
            <a href={`/?workdir=${encodeURIComponent(w.path)}`}
               class="lib-item child" data-active={w.path === activeWorkdir} style={w.existsOnDisk ? "" : "opacity:.5;"}>
              <span class="w-1.5 h-1.5 rounded-full" style={`background:${w.existsOnDisk ? "var(--violet)" : "var(--text-faint)"};`}></span>
              <span class="truncate">{w.label}{w.existsOnDisk ? "" : " · deleted"}</span>
              <span class="ml-auto text-[11px]">{w.sessionCount}</span>
            </a>
          ))}
        </div>
      </div>
    ))}
  </nav>
</div>

<style>
  .lib-item { display:flex; align-items:center; gap:9px; padding:6px 10px; border-radius:7px; cursor:pointer; white-space:nowrap; font-size:14px; color:var(--text-dim); text-decoration:none; }
  .lib-item:hover { background:var(--panel-2); color:var(--text); }
  .lib-item[data-active="true"] { background:var(--raise); color:var(--text); }
  .lib-item.child { padding-left:30px; font-size:13px; }
  .caret { background:none; border:none; color:var(--text-faint); width:10px; cursor:pointer; transition:transform .15s; }
  .repo-group[data-open="true"] .caret { transform:rotate(90deg); }
  .children { display:none; }
  .repo-group[data-open="true"] .children { display:block; }
</style>

<script>
  // Collapse/expand without navigating when the caret is clicked.
  document.querySelectorAll(".caret").forEach((c) => {
    c.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const group = (e.currentTarget as HTMLElement).closest(".repo-group") as HTMLElement;
      group.dataset.open = group.dataset.open === "true" ? "false" : "true";
    });
  });
</script>
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `npm run build:web`
Expected: "Complete!"

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.astro
git commit -m "feat(ui): Sidebar library tree (repo->workdir->session)"
```

---

## Task 7: `SessionListPane.astro` date-grouped cards

**Files:**
- Create: `src/components/SessionListPane.astro`

- [ ] **Step 1: Create the list pane**

```astro
---
// src/components/SessionListPane.astro
import type { GroupedList } from "../db/library";
import { formatTimestamp } from "../lib/render";
interface Props { data: GroupedList; activeSession?: string; }
const { data, activeSession } = Astro.props;
---
<div class="px-[18px] pt-4 pb-3" style="border-bottom:1px solid var(--border-soft);">
  {data.header.subtitle && <div class="text-[12px]" style="color:var(--text-faint);">{data.header.subtitle}</div>}
  <h2 class="font-serif text-[21px] font-semibold flex items-center gap-2" style="color:var(--text);">{data.header.title}</h2>
</div>
<div class="overflow-y-auto flex-1 px-2.5 pb-5">
  {data.groups.length === 0 && (
    <p class="px-3 py-8 text-center text-[13px]" style="color:var(--text-faint);">No sessions here.</p>
  )}
  {data.groups.map((g) => (
    <>
      <div class="text-[11px] tracking-wider uppercase px-2.5 pt-3.5 pb-1.5 font-semibold" style="color:var(--text-faint);">{g.label}</div>
      {g.items.map((it) => (
        <a href={`/?session=${it.id}`} class="card" data-active={it.id === activeSession}>
          <div class="ct-title">{it.title}</div>
          <div class="ct-meta">
            <span class="badge wd">{it.workdirLabel}</span>
            <span>{it.messageCount.toLocaleString()} msgs</span>
            {it.compactCount > 0 && <span class="badge cmp">{it.compactCount} compact</span>}
            <span class="ml-auto">{formatTimestamp(it.lastActivity)}</span>
          </div>
        </a>
      ))}
    </>
  ))}
</div>

<style>
  .card { display:block; padding:11px 12px; border-radius:10px; cursor:pointer; border:1px solid transparent; text-decoration:none; }
  .card:hover { background:var(--panel); }
  .card[data-active="true"] { background:var(--panel); border-color:var(--border); }
  .ct-title { font-size:13.5px; color:var(--text); font-weight:500; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.4; }
  .ct-meta { display:flex; align-items:center; gap:8px; margin-top:7px; font-size:11.5px; color:var(--text-faint); }
  .badge { display:inline-flex; align-items:center; gap:4px; padding:1px 7px; border-radius:12px; font-size:10.5px; font-family:var(--mono); }
  .badge.wd { background:rgba(155,130,214,.14); color:#b6a2e0; }
  .badge.cmp { background:rgba(207,138,74,.16); color:#e0a368; }
</style>
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `npm run build:web`
Expected: "Complete!"

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionListPane.astro
git commit -m "feat(ui): SessionListPane date-grouped session cards"
```

---

## Task 8: Wire `index.astro` to the shell + reader placeholder

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Replace index with the shell host**

Replace the entire contents of `src/pages/index.astro` with:

```astro
---
import AppShell from "../layouts/AppShell.astro";
import Sidebar from "../components/Sidebar.astro";
import SessionListPane from "../components/SessionListPane.astro";
import { openDb } from "../db/init";
import { getLibraryTree, listSessionsGrouped, type Selection } from "../db/library";
import { getIndexStats } from "../db/stats";
import { INDEX_DB_PATH } from "../paths";

const url = Astro.url;
const repo = url.searchParams.get("repo") ?? undefined;
const workdir = url.searchParams.get("workdir") ?? undefined;
const mode = (url.searchParams.get("mode") as "recent" | "all" | null) ?? undefined;
const session = url.searchParams.get("session") ?? undefined;

const sel: Selection = repo ? { repo } : workdir ? { workdir } : { mode: mode ?? "recent" };

const db = openDb(INDEX_DB_PATH);
const tree = getLibraryTree(db);
const list = listSessionsGrouped(db, sel, Date.now());
const stats = getIndexStats(db);
db.close();
---
<AppShell title="ccaudit">
  <Sidebar slot="sidebar" tree={tree} activeRepo={repo} activeWorkdir={workdir} mode={mode} />
  <SessionListPane slot="list" data={list} activeSession={session} />
  <div slot="reader" class="p-8">
    {session ? (
      <div class="max-w-prose">
        <p class="text-[13px]" style="color:var(--text-dim);">Opening the full reader…</p>
        <a class="underline" style="color:var(--amber);" href={`/s/${session}`}>View session {session.slice(0,8)} →</a>
        <script is:inline set:html={`location.href='/s/${session}'`}></script>
      </div>
    ) : (
      <div>
        <h2 class="font-serif text-[26px] font-semibold mb-1" style="color:var(--text);">Your Claude history</h2>
        <p class="text-[14px] mb-6" style="color:var(--text-dim);">Pick a repository or session on the left to start reading.</p>
        <div class="flex gap-3 flex-wrap">
          <div class="rounded-xl px-5 py-4" style="background:var(--panel); border:1px solid var(--border-soft);">
            <div class="font-serif text-[28px]" style="color:var(--text);">{stats.totalSessions}</div>
            <div class="text-[12px] uppercase tracking-wider" style="color:var(--text-faint);">sessions</div>
          </div>
          <div class="rounded-xl px-5 py-4" style="background:var(--panel); border:1px solid var(--border-soft);">
            <div class="font-serif text-[28px]" style="color:var(--text);">{stats.totalMessages.toLocaleString()}</div>
            <div class="text-[12px] uppercase tracking-wider" style="color:var(--text-faint);">messages</div>
          </div>
          <div class="rounded-xl px-5 py-4" style="background:var(--panel); border:1px solid var(--border-soft);">
            <div class="font-serif text-[28px]" style="color:var(--c-orange);">{stats.sessionsWithCompacts}</div>
            <div class="text-[12px] uppercase tracking-wider" style="color:var(--text-faint);">with compacts</div>
          </div>
        </div>
      </div>
    )}
  </div>
</AppShell>
```

> Note: selecting a session currently redirects to the existing `/s/[id]` reader. The in-shell reader refactor is Phase 2.

- [ ] **Step 2: Build the web bundle**

Run: `npm run build:web`
Expected: "Complete!"

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(ui): home becomes the 3-pane shell (sidebar + grouped list + dashboard)"
```

---

## Task 9: Update the smoke test to assert the shell renders

**Files:**
- Modify: `tests/astro-smoke.test.ts`

- [ ] **Step 1: Read the current smoke test, then add a shell assertion**

Add a check that the home response HTML contains the sidebar brand and a Library section. Append inside the existing test's assertions (after the server is up and `/` is fetched):

```typescript
// after fetching the home page HTML into a variable `html`:
expect(html).toContain("ccaudit");           // brand
expect(html).toContain("Library");           // sidebar section
expect(html).toContain("Repositories");      // sidebar section
```

(If the smoke test does not already fetch `/` into `html`, add:
`const html = await (await fetch(base + "/")).text();` before the assertions.)

- [ ] **Step 2: Run the smoke test**

Run: `npx vitest run tests/astro-smoke.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/astro-smoke.test.ts
git commit -m "test(smoke): assert the 3-pane shell renders on home"
```

---

## Task 10: Full verification (tests + typecheck + Playwright)

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all green (existing + new library tests + smoke).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit && npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Build + boot + Playwright screenshot**

```bash
npm run build && npm run build:web
PORT=4399 HOST=127.0.0.1 node ./dist-web/server/entry.mjs &
# wait for up, then via playwright-skill capture /  and /?repo=<id>
```
Drive the playwright-skill to screenshot the home shell (default + a repo selected) at 1440×900. Visually confirm: warm-obsidian dark canvas, sidebar repo tree with green/violet dots, date-grouped cards, dashboard stats. Stop the server after.

- [ ] **Step 4: Commit any tweaks from visual review, then mark Phase 1 complete**

```bash
git add -A && git commit -m "chore(ui): phase-1 shell visual polish from Playwright review"
```

---

## Self-Review

- **Spec coverage (Phase 1–3 slice):** design tokens (Task 4) ✓; AppShell 3-pane (Task 5) ✓; sidebar repo-first tree (Task 6, getLibraryTree Task 2) ✓; date-grouped list (Task 7, listSessionsGrouped Task 3) ✓; exclusions honored (Task 2/3 tests) ✓; dashboard empty-state (Task 8) ✓; dark-first (Task 4/5) ✓. Deferred-by-design: reader refactor, noise cleanup, ⌘K, graph zoom-to-fit, analytics merge, light parity (later phases — stated in Scope note).
- **Placeholders:** none — every step has full code/commands.
- **Type consistency:** `LibraryTree`/`LibraryRepo`/`LibraryWorkdir`/`LibrarySession`, `Selection`, `GroupedList`/`ListGroup`/`ListItem`, `DayLabel`, `dayBucket` are defined in Tasks 1–3 and consumed consistently in Tasks 6–8. `getLibraryTree`/`listSessionsGrouped` signatures match between definition and use. `formatTimestamp` is the existing `src/lib/render` export.
- **Note:** Task 6 `<a>` wrapping a `<button class="caret">` — the script calls `preventDefault` so caret toggles instead of navigating; clicking the row text still navigates. Acceptable.
