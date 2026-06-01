# Running-Session Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track Claude Code's running sessions, persist them across machine restarts, detect when an instance ends, and surface a "running now / recently ended" view with one-click resume — all locally, never writing to `~/.claude`.

**Architecture:** A `~/.claude/sessions/<pid>.json` registry (one file per live Claude Code instance) is read read-only by a short-lived `ccaudit watch-tick` that a launchd LaunchAgent fires every ~30s. Each tick reconciles the registry into a new `live_sessions` table in `~/.ccaudit/index.db` (running rows refreshed, vanished rows marked ended — `restart` vs `exited` by comparing `last_seen` to the machine boot time). The Web UI and `ccaudit live` read that table, plus an on-demand registry read so the live view works even with no watcher installed.

**Tech Stack:** TypeScript (ESM, `noUncheckedIndexedAccess` on), better-sqlite3, Astro 5 SSR (`APIRoute` + `.astro` pages), commander CLI, vitest, macOS launchd. Time helpers from `src/lib/render.ts` (`relativeTime`, `formatTimestamp`); shell-safety from `src/lib/shell.ts` (`posixQuote`).

**Conventions to follow (already established in this codebase):**
- DB-ops modules take a typed `Database.Database` as first arg, use prepared statements, and return camelCase-keyed objects (see `src/db/topics.ts`).
- DB tests use `mkdtempSync(join(tmpdir(), "ccaudit-…"))` + `openDb(dbp)`; clean up in `afterEach` (see `tests/topics-db.test.ts`).
- `noUncheckedIndexedAccess` is ON — array index access needs `!` or `?? fallback`.
- Imports inside `src/**` use the `.js` extension even for `.ts` files (ESM/NodeNext).
- Run a single test file with `npx vitest run tests/<file>.test.ts`; the whole suite with `npm test`.
- Tests must be watched failing before the implementation is written (TDD — superpowers:test-driven-development).

---

## File Structure

**New files:**
- `src/watch/registry.ts` — read `~/.claude/sessions/*.json`, filter to live PIDs. Pure I/O, injectable deps.
- `src/watch/tick.ts` — `runWatchTick`: reconcile registry → `live_sessions` (running/ended transitions). Pure logic, injectable deps.
- `src/db/live-sessions.ts` — `upsertLive` / `markEnded` / `listLive` / `indexedSessionIds` over the `live_sessions` table.
- `src/lib/boot-time.ts` — machine boot time (macOS `sysctl`, Linux `/proc/uptime`), with a pure parse helper.
- `src/lib/config.ts` — best-effort `~/.ccaudit/config.json` read/write (`readConfig` / `writeConfig`).
- `src/lib/resume.ts` — shared `buildResumeCommand(sessionId, cwd)` (factored out of `SessionReader.astro`).
- `src/lib/launchd.ts` — pure `buildPlist(...)` + `installAgent` / `uninstallAgent` / `agentInstalled`.
- `src/cli/watch.ts` — `watchCommand` (`--install`/`--uninstall`/`--status`) and `watchTickCommand` (hidden, launchd entry point).
- `src/cli/live.ts` — `liveCommand`: terminal table of running + recently-ended sessions.
- `src/pages/api/live.ts` — `GET /api/live` → `{ running, recentlyEnded }`.
- `src/pages/live.astro` — the "Live" reader page.

**New test files:**
- `tests/registry.test.ts`, `tests/live-sessions-db.test.ts`, `tests/boot-time.test.ts`, `tests/watch-tick.test.ts`, `tests/config.test.ts`, `tests/resume.test.ts`, `tests/launchd.test.ts`.

**Modified files:**
- `src/paths.ts` — add `CLAUDE_SESSIONS_DIR`, `CONFIG_PATH`.
- `src/db/init.ts` — add the `live_sessions` table to `SCHEMA`.
- `src/components/SessionReader.astro` — use `buildResumeCommand`.
- `src/components/Sidebar.astro` — "Running now (N)" section + "Live" nav entry + client poll.
- `src/cli/serve.ts` — install-UX flow (`--watch`/`--no-watch`/TTY prompt).
- `src/cli/index.ts` — register `watch`, `watch-tick`, `live`; add `--watch`/`--no-watch` to `serve`.

---

## Task 1: Paths — sessions dir + config path

**Files:**
- Modify: `src/paths.ts`
- Test: `tests/paths.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/paths.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";

// paths.ts reads env at module-eval time, so we re-import with a reset module
// registry per case to exercise the override branch.
async function freshPaths(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  // @ts-expect-error vitest provides resetModules
  const vitest = await import("vitest");
  vitest.vi.resetModules();
  const mod = await import("../src/paths.js?" + Math.random());
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
  return mod;
}

describe("paths: sessions dir + config", () => {
  it("defaults CLAUDE_SESSIONS_DIR to ~/.claude/sessions", async () => {
    const p = await freshPaths({ CCAUDIT_SESSIONS_DIR: undefined });
    expect(p.CLAUDE_SESSIONS_DIR).toBe(join(homedir(), ".claude", "sessions"));
  });
  it("honours CCAUDIT_SESSIONS_DIR override", async () => {
    const p = await freshPaths({ CCAUDIT_SESSIONS_DIR: "/tmp/fake-sessions" });
    expect(p.CLAUDE_SESSIONS_DIR).toBe("/tmp/fake-sessions");
  });
  it("CONFIG_PATH lives under the ccaudit home", async () => {
    const p = await freshPaths({ CCAUDIT_HOME: "/tmp/cc-home" });
    expect(p.CONFIG_PATH).toBe(join("/tmp/cc-home", "config.json"));
  });
});
```

> Note: the dynamic-import-with-query trick re-evaluates `paths.ts` so the env override is read fresh. If the query-string import is flaky in this toolchain, simplify the override tests to assert on the default values only and verify the override branch by reading the source — but keep the default-value assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/paths.test.ts`
Expected: FAIL — `CLAUDE_SESSIONS_DIR` / `CONFIG_PATH` are `undefined` (not exported yet).

- [ ] **Step 3: Add the exports**

In `src/paths.ts`, after the existing `LOGS_DIR` line (line 11), add:

```ts
export const CLAUDE_SESSIONS_DIR = process.env.CCAUDIT_SESSIONS_DIR || join(home(), ".claude", "sessions");
export const CONFIG_PATH = join(ccauditHome(), "config.json");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paths.ts tests/paths.test.ts
git commit -m "feat(watch): add CLAUDE_SESSIONS_DIR + CONFIG_PATH paths"
```

---

## Task 2: Registry reader

**Files:**
- Create: `src/watch/registry.ts`
- Test: `tests/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLiveRegistry } from "../src/watch/registry.js";

describe("readLiveRegistry", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ccaudit-reg-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (pid: number, obj: Record<string, unknown>) =>
    writeFileSync(join(dir, `${pid}.json`), JSON.stringify(obj));

  it("returns parsed live instances and maps the fields", () => {
    write(100, { pid: 100, sessionId: "s-a", cwd: "/work/a", name: "alpha", status: "waiting", waitingFor: "permission prompt", version: "2.1.154", startedAt: 111, updatedAt: 222 });
    const live = readLiveRegistry({ dir, isAlive: () => true });
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ pid: 100, sessionId: "s-a", cwd: "/work/a", name: "alpha", status: "waiting", version: "2.1.154", startedAt: 111, updatedAt: 222 });
  });

  it("drops entries whose pid is not alive", () => {
    write(100, { pid: 100, sessionId: "s-a" });
    write(200, { pid: 200, sessionId: "s-b" });
    const live = readLiveRegistry({ dir, isAlive: (pid) => pid === 100 });
    expect(live.map((l) => l.sessionId)).toEqual(["s-a"]);
  });

  it("skips malformed files without throwing", () => {
    writeFileSync(join(dir, "300.json"), "{ not json");
    write(100, { pid: 100, sessionId: "s-a" });
    const live = readLiveRegistry({ dir, isAlive: () => true });
    expect(live.map((l) => l.sessionId)).toEqual(["s-a"]);
  });

  it("skips entries missing a sessionId or pid", () => {
    write(100, { pid: 100 });               // no sessionId
    writeFileSync(join(dir, "x.json"), JSON.stringify({ sessionId: "s-b" })); // no pid
    expect(readLiveRegistry({ dir, isAlive: () => true })).toEqual([]);
  });

  it("returns [] when the directory does not exist", () => {
    expect(readLiveRegistry({ dir: join(dir, "nope"), isAlive: () => true })).toEqual([]);
  });

  // PID-reuse-across-reboot guard (validated by PoC: ~/.claude/sessions files survive a
  // reboot; their pids may be dead OR reused by unrelated processes). A genuinely-live
  // Claude session's startedAt is always AFTER the machine boot, so anything older is a
  // pre-reboot leftover even if its pid now resolves to some other live process.
  it("drops entries whose startedAt predates bootTime (stale pre-reboot files)", () => {
    write(100, { pid: 100, sessionId: "before", startedAt: 500 });  // started before boot
    write(200, { pid: 200, sessionId: "after", startedAt: 1500 });  // started after boot
    const live = readLiveRegistry({ dir, isAlive: () => true, bootTime: 1000 });
    expect(live.map((l) => l.sessionId)).toEqual(["after"]);
  });

  it("keeps entries with a null/unknown startedAt even when bootTime is set", () => {
    writeFileSync(join(dir, "300.json"), JSON.stringify({ pid: 300, sessionId: "unknown" })); // no startedAt
    const live = readLiveRegistry({ dir, isAlive: () => true, bootTime: 1000 });
    expect(live.map((l) => l.sessionId)).toEqual(["unknown"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registry.test.ts`
Expected: FAIL — cannot find module `../src/watch/registry.js`.

- [ ] **Step 3: Implement the reader**

Create `src/watch/registry.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_SESSIONS_DIR } from "../paths.js";

/** One running Claude Code instance, as recorded in ~/.claude/sessions/<pid>.json. */
export type LiveInstance = {
  pid: number;
  sessionId: string;
  cwd: string | null;
  name: string | null;
  status: string | null;
  waitingFor: string | null;
  version: string | null;
  startedAt: number | null;
  updatedAt: number | null;
};

export type ReadRegistryOpts = {
  /** Directory of <pid>.json files. Defaults to ~/.claude/sessions. */
  dir?: string;
  /** Liveness probe. Defaults to `process.kill(pid, 0)` (false on ESRCH). */
  isAlive?: (pid: number) => boolean;
  /**
   * Machine boot time (epoch ms). When > 0, entries whose `startedAt` predates it
   * are dropped — they are pre-reboot leftovers (the sessions dir survives reboots)
   * whose pid may now be reused by an unrelated process. Entries with an unknown
   * startedAt are kept. Pass `getBootTime()`.
   */
  bootTime?: number;
};

function defaultIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } // EPERM = exists but not ours
}

function str(v: unknown): string | null { return typeof v === "string" ? v : null; }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }

/**
 * Read the live-session registry, keeping only entries whose pid is currently alive.
 * Tolerates a missing dir and malformed/partial files (both are skipped).
 */
export function readLiveRegistry(opts: ReadRegistryOpts = {}): LiveInstance[] {
  const dir = opts.dir ?? CLAUDE_SESSIONS_DIR;
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const bootTime = opts.bootTime ?? 0;
  let names: string[];
  try { names = readdirSync(dir); }
  catch { return []; } // ENOENT etc. — no registry, nothing running we can see

  const out: LiveInstance[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(join(dir, name), "utf8")); }
    catch { continue; } // unreadable / malformed — skip
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const pid = num(o.pid);
    const sessionId = str(o.sessionId);
    if (pid === null || !sessionId) continue;
    if (!isAlive(pid)) continue;
    const startedAt = num(o.startedAt);
    // Pre-reboot leftover whose pid may be reused: a live session always started after boot.
    if (bootTime > 0 && startedAt !== null && startedAt < bootTime) continue;
    out.push({
      pid, sessionId,
      cwd: str(o.cwd), name: str(o.name), status: str(o.status),
      waitingFor: str(o.waitingFor), version: str(o.version),
      startedAt, updatedAt: num(o.updatedAt),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/registry.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/watch/registry.ts tests/registry.test.ts
git commit -m "feat(watch): read ~/.claude/sessions registry, filtered to live pids"
```

---

## Task 3: `live_sessions` table + DB ops

**Files:**
- Modify: `src/db/init.ts` (add table to `SCHEMA`)
- Create: `src/db/live-sessions.ts`
- Test: `tests/live-sessions-db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/live-sessions-db.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertLive, markEnded, listLive, indexedSessionIds } from "../src/db/live-sessions.js";
import type { LiveInstance } from "../src/watch/registry.js";

const inst = (over: Partial<LiveInstance> & { sessionId: string }): LiveInstance => ({
  pid: 1, cwd: "/w", name: "n", status: "waiting", waitingFor: null, version: "2.1", startedAt: 1, updatedAt: 1, ...over,
});

describe("db/live-sessions", () => {
  let tmp: string, dbp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-live-")); dbp = join(tmp, "t.db"); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("upserts a running row and refreshes it without duplicating", () => {
    const db = openDb(dbp);
    upsertLive(db, inst({ sessionId: "a", status: "waiting" }), 1000);
    upsertLive(db, inst({ sessionId: "a", status: "thinking" }), 2000);
    const rows = listLive(db, { endedSince: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: "a", status: "thinking", lastSeen: 2000, firstSeen: 1000, endedAt: null });
  });

  it("overwrites started_at on the same session id (pid reuse) — still one row", () => {
    const db = openDb(dbp);
    upsertLive(db, inst({ sessionId: "a", startedAt: 100 }), 1000);
    upsertLive(db, inst({ sessionId: "a", startedAt: 200 }), 2000);
    const rows = listLive(db, { endedSince: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startedAt).toBe(200);
  });

  it("markEnded sets ended_at + reason and re-upsert clears it (came back)", () => {
    const db = openDb(dbp);
    upsertLive(db, inst({ sessionId: "a" }), 1000);
    markEnded(db, "a", 3000, "exited");
    let rows = listLive(db, { endedSince: 0 });
    expect(rows[0]).toMatchObject({ endedAt: 3000, endedReason: "exited" });
    upsertLive(db, inst({ sessionId: "a" }), 4000);
    rows = listLive(db, { endedSince: 0 });
    expect(rows[0]).toMatchObject({ endedAt: null, endedReason: null, lastSeen: 4000 });
  });

  it("listLive orders running first, then ended by recency, and honours endedSince", () => {
    const db = openDb(dbp);
    upsertLive(db, inst({ sessionId: "run", status: "x" }), 5000);
    upsertLive(db, inst({ sessionId: "old" }), 1000); markEnded(db, "old", 1500, "exited");
    upsertLive(db, inst({ sessionId: "new" }), 2000); markEnded(db, "new", 9000, "restart");
    const rows = listLive(db, { endedSince: 2000 });
    expect(rows.map((r) => r.sessionId)).toEqual(["run", "new"]); // "old" ended before endedSince → excluded
    expect(rows[0]!.endedAt).toBeNull();
  });

  it("indexedSessionIds returns the subset present in the sessions table", () => {
    const db = openDb(dbp);
    db.prepare("INSERT INTO sessions (id, project_dir, project_label, file_path, file_mtime, file_size, indexed_at) VALUES (?,?,?,?,?,?,?)")
      .run("a", "/p", "p", "/p/a.jsonl", 0, 0, 0);
    expect([...indexedSessionIds(db, ["a", "b"])]).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/live-sessions-db.test.ts`
Expected: FAIL — cannot find module `../src/db/live-sessions.js`.

- [ ] **Step 3a: Add the table to the schema**

In `src/db/init.ts`, inside the `SCHEMA` template string, append after the `topic_members` index (line 142, before the closing backtick):

```sql

-- Snapshot of Claude Code's live running sessions (from ~/.claude/sessions/<pid>.json),
-- persisted so a machine restart doesn't lose track of what was open. Keyed by
-- session_id; one row per session, ended_at NULL while running.
CREATE TABLE IF NOT EXISTS live_sessions (
  session_id   TEXT PRIMARY KEY,
  pid          INTEGER,
  cwd          TEXT,
  name         TEXT,
  status       TEXT,
  version      TEXT,
  started_at   INTEGER,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  ended_at     INTEGER,
  ended_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_live_last_seen ON live_sessions(last_seen DESC);
```

- [ ] **Step 3b: Implement the DB ops**

Create `src/db/live-sessions.ts`:

```ts
import type Database from "better-sqlite3";
import type { LiveInstance } from "../watch/registry.js";

export type LiveRow = {
  sessionId: string;
  pid: number | null;
  cwd: string | null;
  name: string | null;
  status: string | null;
  version: string | null;
  startedAt: number | null;
  firstSeen: number;
  lastSeen: number;
  endedAt: number | null;
  endedReason: string | null;
};

type RawRow = {
  session_id: string; pid: number | null; cwd: string | null; name: string | null;
  status: string | null; version: string | null; started_at: number | null;
  first_seen: number; last_seen: number; ended_at: number | null; ended_reason: string | null;
};

function mapRow(r: RawRow): LiveRow {
  return {
    sessionId: r.session_id, pid: r.pid, cwd: r.cwd, name: r.name, status: r.status,
    version: r.version, startedAt: r.started_at, firstSeen: r.first_seen, lastSeen: r.last_seen,
    endedAt: r.ended_at, endedReason: r.ended_reason,
  };
}

/** Insert or refresh a running row. Clears any prior ended state; first_seen is kept on refresh. */
export function upsertLive(db: Database.Database, inst: LiveInstance, now: number): void {
  db.prepare(`
    INSERT INTO live_sessions
      (session_id, pid, cwd, name, status, version, started_at, first_seen, last_seen, ended_at, ended_reason)
    VALUES (@sessionId, @pid, @cwd, @name, @status, @version, @startedAt, @now, @now, NULL, NULL)
    ON CONFLICT(session_id) DO UPDATE SET
      pid=excluded.pid, cwd=excluded.cwd, name=excluded.name, status=excluded.status,
      version=excluded.version, started_at=excluded.started_at,
      last_seen=excluded.last_seen, ended_at=NULL, ended_reason=NULL
  `).run({
    sessionId: inst.sessionId, pid: inst.pid, cwd: inst.cwd, name: inst.name, status: inst.status,
    version: inst.version, startedAt: inst.startedAt, now,
  });
}

export function markEnded(db: Database.Database, sessionId: string, at: number, reason: "exited" | "restart"): void {
  db.prepare("UPDATE live_sessions SET ended_at=?, ended_reason=? WHERE session_id=? AND ended_at IS NULL")
    .run(at, reason, sessionId);
}

/** Running rows first (by last_seen desc), then ended rows with ended_at >= endedSince (by ended_at desc). */
export function listLive(db: Database.Database, opts: { endedSince?: number } = {}): LiveRow[] {
  const since = opts.endedSince ?? 0;
  const rows = db.prepare(`
    SELECT * FROM live_sessions
     WHERE ended_at IS NULL OR ended_at >= ?
     ORDER BY (ended_at IS NULL) DESC, COALESCE(ended_at, last_seen) DESC
  `).all(since) as RawRow[];
  return rows.map(mapRow);
}

/** Of the given session ids, which exist in the indexed `sessions` table. */
export function indexedSessionIds(db: Database.Database, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id FROM sessions WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/live-sessions-db.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/db/init.ts src/db/live-sessions.ts tests/live-sessions-db.test.ts
git commit -m "feat(watch): live_sessions table + upsert/markEnded/listLive ops"
```

---

## Task 4: Boot time

**Files:**
- Create: `src/lib/boot-time.ts`
- Test: `tests/boot-time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/boot-time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDarwinBoottimeSec } from "../src/lib/boot-time.js";

describe("parseDarwinBoottimeSec", () => {
  it("extracts the sec field from `sysctl -n kern.boottime` output", () => {
    const out = "{ sec = 1780001577, usec = 0 } Thu May 28 20:52:57 2026\n";
    expect(parseDarwinBoottimeSec(out)).toBe(1780001577);
  });
  it("tolerates extra whitespace around the equals sign", () => {
    expect(parseDarwinBoottimeSec("{ sec=42, usec=0 }")).toBe(42);
  });
  it("returns null when there is no sec field", () => {
    expect(parseDarwinBoottimeSec("garbage")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/boot-time.test.ts`
Expected: FAIL — cannot find module `../src/lib/boot-time.js`.

- [ ] **Step 3: Implement boot time**

Create `src/lib/boot-time.ts`:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Parse the seconds from macOS `sysctl -n kern.boottime` output. */
export function parseDarwinBoottimeSec(out: string): number | null {
  const m = out.match(/sec\s*=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Machine boot time in epoch ms. macOS via sysctl, Linux via /proc/uptime.
 * Returns 0 on anything unexpected (caller then treats every gone session as
 * 'exited' rather than 'restart' — a safe degradation). `now` is injectable.
 */
export function getBootTime(now: number = Date.now()): number {
  try {
    if (process.platform === "darwin") {
      const out = execFileSync("sysctl", ["-n", "kern.boottime"], { encoding: "utf8" });
      const sec = parseDarwinBoottimeSec(out);
      return sec ? sec * 1000 : 0;
    }
    if (process.platform === "linux") {
      const up = readFileSync("/proc/uptime", "utf8");
      const secs = parseFloat(up.split(/\s+/)[0] ?? "");
      return Number.isFinite(secs) ? now - secs * 1000 : 0;
    }
  } catch { /* fall through to 0 */ }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/boot-time.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boot-time.ts tests/boot-time.test.ts
git commit -m "feat(watch): machine boot-time helper (macOS sysctl / Linux uptime)"
```

---

## Task 5: Tick / reconcile

**Files:**
- Create: `src/watch/tick.ts`
- Test: `tests/watch-tick.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/watch-tick.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { listLive } from "../src/db/live-sessions.js";
import { runWatchTick } from "../src/watch/tick.js";
import type { LiveInstance } from "../src/watch/registry.js";

const inst = (sessionId: string, over: Partial<LiveInstance> = {}): LiveInstance => ({
  pid: 1, sessionId, cwd: "/w", name: sessionId, status: "waiting", waitingFor: null, version: "2.1", startedAt: 1, updatedAt: 1, ...over,
});

describe("runWatchTick", () => {
  let tmp: string, dbp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-tick-")); dbp = join(tmp, "t.db"); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("marks a vanished session 'exited' when it disappeared after boot", () => {
    const db = openDb(dbp);
    runWatchTick(db, { now: 1000, bootTime: 0, registry: () => [inst("a"), inst("b")] });
    const summary = runWatchTick(db, { now: 2000, bootTime: 0, registry: () => [inst("a")] });
    expect(summary).toEqual({ running: 1, endedNow: 1 });
    const rows = listLive(db, { endedSince: 0 });
    const b = rows.find((r) => r.sessionId === "b")!;
    expect(b).toMatchObject({ endedAt: 2000, endedReason: "exited" });
    expect(rows.find((r) => r.sessionId === "a")!.endedAt).toBeNull();
  });

  it("classifies sessions last seen before boot as 'restart'", () => {
    const db = openDb(dbp);
    runWatchTick(db, { now: 1000, bootTime: 5000, registry: () => [inst("a")] }); // last_seen=1000
    runWatchTick(db, { now: 6000, bootTime: 5000, registry: () => [] });           // a gone, 1000 < 5000
    const rows = listLive(db, { endedSince: 0 });
    expect(rows[0]).toMatchObject({ sessionId: "a", endedReason: "restart" });
  });

  it("does not duplicate rows or re-end already-ended sessions", () => {
    const db = openDb(dbp);
    runWatchTick(db, { now: 1000, bootTime: 0, registry: () => [inst("a")] });
    runWatchTick(db, { now: 2000, bootTime: 0, registry: () => [] }); // a -> ended @2000
    const s = runWatchTick(db, { now: 3000, bootTime: 0, registry: () => [] }); // still gone
    expect(s.endedNow).toBe(0);
    const rows = listLive(db, { endedSince: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endedAt).toBe(2000); // unchanged
  });

  it("overwrites started_at on pid reuse without creating a second row", () => {
    const db = openDb(dbp);
    runWatchTick(db, { now: 1000, bootTime: 0, registry: () => [inst("a", { startedAt: 1 })] });
    runWatchTick(db, { now: 2000, bootTime: 0, registry: () => [inst("a", { startedAt: 2 })] });
    const rows = listLive(db, { endedSince: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startedAt).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/watch-tick.test.ts`
Expected: FAIL — cannot find module `../src/watch/tick.js`.

- [ ] **Step 3: Implement the tick**

Create `src/watch/tick.ts`:

```ts
import type Database from "better-sqlite3";
import type { LiveInstance } from "./registry.js";
import { upsertLive, markEnded } from "../db/live-sessions.js";

export type WatchTickDeps = {
  now: number;
  bootTime: number;
  registry: () => LiveInstance[];
};

export type WatchTickSummary = { running: number; endedNow: number };

/**
 * One reconcile pass: refresh every live instance, then mark any still-running DB
 * row that's no longer in the registry as ended — 'restart' if its last_seen
 * predates the machine boot, else 'exited'. Idempotent and wrapped in a single tx.
 */
export function runWatchTick(db: Database.Database, deps: WatchTickDeps): WatchTickSummary {
  const live = deps.registry();
  const liveIds = new Set(live.map((l) => l.sessionId));

  const tx = db.transaction((): number => {
    for (const inst of live) upsertLive(db, inst, deps.now);
    const running = db.prepare(
      "SELECT session_id AS sessionId, last_seen AS lastSeen FROM live_sessions WHERE ended_at IS NULL"
    ).all() as Array<{ sessionId: string; lastSeen: number }>;
    let endedNow = 0;
    for (const row of running) {
      if (liveIds.has(row.sessionId)) continue;
      const reason = row.lastSeen < deps.bootTime ? "restart" : "exited";
      markEnded(db, row.sessionId, deps.now, reason);
      endedNow++;
    }
    return endedNow;
  });

  const endedNow = tx();
  return { running: live.length, endedNow };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/watch-tick.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/watch/tick.ts tests/watch-tick.test.ts
git commit -m "feat(watch): reconcile tick — running/ended transitions, restart vs exited"
```

---

## Task 6: Config module

**Files:**
- Create: `src/lib/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("lib/config", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-cfg-")); process.env.CCAUDIT_HOME = tmp; vi.resetModules(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); delete process.env.CCAUDIT_HOME; });

  it("returns {} when no config file exists", async () => {
    const { readConfig } = await import("../src/lib/config.js");
    expect(readConfig()).toEqual({});
  });

  it("writeConfig merges a patch and persists it", async () => {
    const { readConfig, writeConfig } = await import("../src/lib/config.js");
    writeConfig({ watch: "installed" });
    expect(readConfig()).toEqual({ watch: "installed" });
    writeConfig({ somethingElse: true } as Record<string, unknown>);
    expect(readConfig()).toMatchObject({ watch: "installed", somethingElse: true });
  });

  it("readConfig tolerates a malformed file (returns {})", async () => {
    writeFileSync(join(tmp, "config.json"), "{ broken");
    const { readConfig } = await import("../src/lib/config.js");
    expect(readConfig()).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot find module `../src/lib/config.js`.

- [ ] **Step 3: Implement config**

Create `src/lib/config.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_PATH } from "../paths.js";

export type CcauditConfig = {
  /** Whether the user installed (or declined) the background session watcher. */
  watch?: "installed" | "declined";
  [k: string]: unknown;
};

/** Best-effort read of ~/.ccaudit/config.json. Missing/malformed → {}. */
export function readConfig(): CcauditConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return raw && typeof raw === "object" ? (raw as CcauditConfig) : {};
  } catch { return {}; }
}

/** Merge `patch` into the config and persist. Best-effort (never throws). */
export function writeConfig(patch: Partial<CcauditConfig>): void {
  try {
    const next = { ...readConfig(), ...patch };
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  } catch { /* best-effort */ }
}
```

> `CONFIG_PATH` is read at module load. The test sets `CCAUDIT_HOME` and calls `vi.resetModules()` before each dynamic import so `paths.ts` re-evaluates against the temp home.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts tests/config.test.ts
git commit -m "feat(config): best-effort ~/.ccaudit/config.json read/write"
```

---

## Task 7: Shared resume-command builder

**Files:**
- Create: `src/lib/resume.ts`
- Modify: `src/components/SessionReader.astro:97-101` (use the shared builder)
- Test: `tests/resume.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/resume.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildResumeCommand } from "../src/lib/resume.js";

describe("buildResumeCommand", () => {
  it("emits the two-line cd + resume snippet for a known cwd", () => {
    expect(buildResumeCommand("s-1", "/Users/me/proj"))
      .toBe("cd '/Users/me/proj'\nclaude --resume s-1");
  });
  it("posix-quotes a cwd containing a single quote", () => {
    expect(buildResumeCommand("s-1", "/tmp/o'brien"))
      .toBe("cd '/tmp/o'\\''brien'\nclaude --resume s-1");
  });
  it("falls back to a one-liner with a note when cwd is null", () => {
    expect(buildResumeCommand("s-1", null))
      .toBe("claude --resume s-1  # original cwd unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/resume.test.ts`
Expected: FAIL — cannot find module `../src/lib/resume.js`.

- [ ] **Step 3: Implement and wire the builder**

Create `src/lib/resume.ts`:

```ts
import { posixQuote } from "./shell.js";

/**
 * The `cd <dir> && claude --resume <id>` snippet shown in the UI. Pass `cwd=null`
 * when the original directory is unknown or no longer on disk (caller checks
 * existsSync); the cwd is POSIX-quoted to stay injection-safe.
 */
export function buildResumeCommand(sessionId: string, cwd: string | null): string {
  return cwd
    ? `cd ${posixQuote(cwd)}\nclaude --resume ${sessionId}`
    : `claude --resume ${sessionId}  # original cwd unknown`;
}
```

In `src/components/SessionReader.astro`, replace the import on line 13 and the builder on lines 99-101.

Change line 13 from:
```ts
import { posixQuote } from "../lib/shell";
```
to:
```ts
import { buildResumeCommand } from "../lib/resume";
```

Change lines 99-101 from:
```ts
const resumeCmd = resumeCwd
  ? `cd ${posixQuote(resumeCwd)}\nclaude --resume ${sessionId}`
  : `claude --resume ${sessionId}  # original cwd unknown`;
```
to:
```ts
const resumeCmd = buildResumeCommand(sessionId, resumeCwd);
```

(Leave line 98 `const resumeCwd = session?.cwd && existsSync(session.cwd) ? session.cwd : null;` unchanged — the `existsSync` I/O stays at the call site.)

- [ ] **Step 4: Run test + typecheck to verify**

Run: `npx vitest run tests/resume.test.ts`
Expected: PASS (all 3).

Run: `npx astro check 2>&1 | tail -5`
Expected: no new errors in `SessionReader.astro` (it no longer references `posixQuote`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/resume.ts src/components/SessionReader.astro tests/resume.test.ts
git commit -m "refactor: extract buildResumeCommand into shared src/lib/resume.ts"
```

---

## Task 8: launchd plist builder + install/uninstall

**Files:**
- Create: `src/lib/launchd.ts`
- Test: `tests/launchd.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/launchd.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPlist, WATCH_LABEL } from "../src/lib/launchd.js";

describe("buildPlist", () => {
  const xml = buildPlist({
    label: WATCH_LABEL, nodePath: "/usr/bin/node", cliPath: "/pkg/dist/index.js",
    interval: 30, logPath: "/home/.ccaudit/logs/watch.log",
  });

  it("uses the ccaudit watch label", () => {
    expect(WATCH_LABEL).toBe("com.ccaudit.watch");
    expect(xml).toContain("<string>com.ccaudit.watch</string>");
  });
  it("invokes `node <cli> watch-tick`", () => {
    expect(xml).toContain("<string>/usr/bin/node</string>");
    expect(xml).toContain("<string>/pkg/dist/index.js</string>");
    expect(xml).toContain("<string>watch-tick</string>");
  });
  it("sets the start interval and RunAtLoad", () => {
    expect(xml).toContain("<key>StartInterval</key>");
    expect(xml).toContain("<integer>30</integer>");
    expect(xml).toContain("<key>RunAtLoad</key>");
    expect(xml).toContain("<true/>");
  });
  it("routes stdout+stderr to the log path", () => {
    expect(xml).toContain("<string>/home/.ccaudit/logs/watch.log</string>");
    expect(xml).toContain("<key>StandardErrorPath</key>");
  });
  it("is a well-formed plist document", () => {
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml).toContain("<!DOCTYPE plist");
    expect(xml.trimEnd().endsWith("</plist>")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/launchd.test.ts`
Expected: FAIL — cannot find module `../src/lib/launchd.js`.

- [ ] **Step 3: Implement launchd**

Create `src/lib/launchd.ts`:

```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const WATCH_LABEL = "com.ccaudit.watch";

export type BuildPlistOpts = {
  label: string;
  nodePath: string;
  cliPath: string;
  interval: number;
  logPath: string;
};

/** Render the LaunchAgent plist XML. Pure — snapshot-tested. */
export function buildPlist(o: BuildPlistOpts): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${o.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${o.nodePath}</string>
    <string>${o.cliPath}</string>
    <string>watch-tick</string>
  </array>
  <key>StartInterval</key>
  <integer>${o.interval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${o.logPath}</string>
  <key>StandardErrorPath</key>
  <string>${o.logPath}</string>
</dict>
</plist>
`;
}

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${WATCH_LABEL}.plist`);
}

/** Whether our LaunchAgent plist is present on disk. */
export function agentInstalled(): boolean {
  return existsSync(plistPath());
}

/**
 * Write the plist and (re)load it via launchctl. macOS only — callers guard the
 * platform. Returns the plist path. Throws if launchctl fails (caller surfaces it).
 */
export function installAgent(opts: { nodePath: string; cliPath: string; logPath: string; interval?: number }): string {
  const path = plistPath();
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(dirname(opts.logPath), { recursive: true });
  writeFileSync(path, buildPlist({
    label: WATCH_LABEL, nodePath: opts.nodePath, cliPath: opts.cliPath,
    interval: opts.interval ?? 30, logPath: opts.logPath,
  }));
  const domain = `gui/${process.getuid?.() ?? 0}`;
  // Re-bootstrap cleanly: ignore a "not loaded" bootout error, then bootstrap.
  try { execFileSync("launchctl", ["bootout", `${domain}/${WATCH_LABEL}`], { stdio: "ignore" }); } catch { /* not loaded */ }
  execFileSync("launchctl", ["bootstrap", domain, path], { stdio: "ignore" });
  return path;
}

/** Unload and remove the LaunchAgent. Best-effort. */
export function uninstallAgent(): void {
  const path = plistPath();
  const domain = `gui/${process.getuid?.() ?? 0}`;
  try { execFileSync("launchctl", ["bootout", `${domain}/${WATCH_LABEL}`], { stdio: "ignore" }); } catch { /* not loaded */ }
  try { rmSync(path, { force: true }); } catch { /* already gone */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/launchd.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/launchd.ts tests/launchd.test.ts
git commit -m "feat(watch): launchd plist builder + install/uninstall agent"
```

---

## Task 9: `watch` + `watch-tick` CLI commands

**Files:**
- Create: `src/cli/watch.ts`
- Modify: `src/cli/index.ts` (register both)

This task is integration glue over already-tested units (`runWatchTick`, `readLiveRegistry`, `getBootTime`, launchd, config). No new unit test; verified by the manual smoke in Task 13.

- [ ] **Step 1: Implement the commands**

Create `src/cli/watch.ts`:

```ts
import kleur from "kleur";
import { join } from "node:path";
import { openDb } from "../db/init.js";
import { readLiveRegistry } from "../watch/registry.js";
import { runWatchTick } from "../watch/tick.js";
import { getBootTime } from "../lib/boot-time.js";
import { listLive } from "../db/live-sessions.js";
import { installAgent, uninstallAgent, agentInstalled, WATCH_LABEL } from "../lib/launchd.js";
import { writeConfig } from "../lib/config.js";
import { INDEX_DB_PATH, LOGS_DIR } from "../paths.js";

const DAY = 86_400_000;

/** Resolve the path the launchd job should run: the CLI bundle node was invoked with. */
function cliEntryPath(): string {
  return process.argv[1] ?? join(process.cwd(), "dist", "index.js");
}

/** Internal: one reconcile pass. Invoked by launchd every interval (and reused by `live`/`serve`). */
export function watchTickCommand(): void {
  const db = openDb(INDEX_DB_PATH);
  try {
    const now = Date.now();
    const bootTime = getBootTime(now);
    const summary = runWatchTick(db, { now, bootTime, registry: () => readLiveRegistry({ bootTime }) });
    // Plain stdout — launchd captures it into ~/.ccaudit/logs/watch.log.
    console.log(`[${new Date(now).toISOString()}] tick — running=${summary.running} endedNow=${summary.endedNow}`);
  } finally {
    db.close();
  }
}

export function watchCommand(opts: { install?: boolean; uninstall?: boolean; status?: boolean }): void {
  if (process.platform !== "darwin" && (opts.install || opts.uninstall)) {
    console.log(kleur.yellow("The background watcher is macOS-only for now."));
    console.log(kleur.dim("The live view still works while ccaudit is open (ccaudit live / the Live page)."));
    return;
  }

  if (opts.uninstall) {
    uninstallAgent();
    writeConfig({ watch: "declined" });
    console.log(kleur.green("✓ Removed the ccaudit session watcher."));
    return;
  }

  if (opts.install) {
    const logPath = join(LOGS_DIR, "watch.log");
    const path = installAgent({ nodePath: process.execPath, cliPath: cliEntryPath(), logPath });
    writeConfig({ watch: "installed" });
    console.log(kleur.green("✓ Installed the ccaudit session watcher.") + kleur.dim(` (${WATCH_LABEL})`));
    console.log(kleur.dim(`  Ticks every 30s · plist ${path} · logs ${logPath}`));
    return;
  }

  // --status (default)
  const installed = agentInstalled();
  const db = openDb(INDEX_DB_PATH);
  try {
    const rows = listLive(db, { endedSince: Date.now() - DAY });
    const running = rows.filter((r) => r.endedAt === null);
    const endedToday = rows.filter((r) => r.endedAt !== null);
    const lastTick = rows.reduce((m, r) => Math.max(m, r.lastSeen), 0);
    console.log(kleur.bold("ccaudit watcher"));
    console.log(`  Installed:    ${installed ? kleur.green("yes") : kleur.yellow("no")}`);
    console.log(`  Running now:  ${running.length}`);
    console.log(`  Ended today:  ${endedToday.length}`);
    console.log(`  Last update:  ${lastTick ? new Date(lastTick).toLocaleString() : "—"}`);
    if (!installed) console.log(kleur.dim("  Install with `ccaudit watch --install` to track sessions across restarts."));
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Register the commands**

In `src/cli/index.ts`, add the import (after line 10, the `nameCommand` import):

```ts
import { watchCommand, watchTickCommand } from "./watch.js";
import { liveCommand } from "./live.js";
```

> `liveCommand` is created in Task 10 — registering both imports together avoids touching this file twice. If you execute Task 9 strictly before Task 10, temporarily comment the `liveCommand` import + its `.command("live")` block and restore it in Task 10. (Recommended: do Tasks 9 and 10 back-to-back, then build once.)

Add the command registrations before `program.parseAsync();` (line 72):

```ts
program
  .command("watch")
  .description("Install/manage the background watcher that tracks running Claude Code sessions")
  .option("--install", "install the launchd watcher (macOS)")
  .option("--uninstall", "remove the watcher")
  .option("--status", "show watcher status (default)")
  .action(watchCommand);

program
  .command("watch-tick", { hidden: true })
  .description("internal: one reconcile pass (invoked by launchd)")
  .action(watchTickCommand);

program
  .command("live")
  .description("Show running (and recently-ended) Claude Code sessions")
  .action(liveCommand);
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build:cli 2>&1 | tail -5`
Expected: tsup builds with no errors. (If you deferred the `liveCommand` import, this step belongs at the end of Task 10.)

- [ ] **Step 4: Smoke the tick against the real registry**

Run: `node dist/index.js watch-tick`
Expected: prints a `[timestamp] tick — running=N endedNow=M` line where N matches your live `~/.claude/sessions/*.json` count. (Read-only on `~/.claude`; writes only to `~/.ccaudit/index.db`.)

- [ ] **Step 5: Commit**

```bash
git add src/cli/watch.ts src/cli/index.ts
git commit -m "feat(cli): ccaudit watch (install/uninstall/status) + hidden watch-tick"
```

---

## Task 10: `live` CLI command

**Files:**
- Create: `src/cli/live.ts`
- (Registration already added in Task 9.)

Integration over tested units. Verified by the manual smoke below.

- [ ] **Step 1: Implement the command**

Create `src/cli/live.ts`:

```ts
import kleur from "kleur";
import { existsSync } from "node:fs";
import { openDb } from "../db/init.js";
import { readLiveRegistry } from "../watch/registry.js";
import { listLive, type LiveRow } from "../db/live-sessions.js";
import { buildResumeCommand } from "../lib/resume.js";
import { getBootTime } from "../lib/boot-time.js";
import { relativeTime } from "../lib/render.js";
import { INDEX_DB_PATH } from "../paths.js";

const DAY = 86_400_000;

function row(cells: string[], widths: number[]): string {
  return cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
}

export function liveCommand(): void {
  const db = openDb(INDEX_DB_PATH);
  try {
    const now = Date.now();
    const reg = readLiveRegistry({ bootTime: getBootTime(now) });
    const regIds = new Set(reg.map((r) => r.sessionId));
    const history = listLive(db, { endedSince: now - DAY });
    const dbById = new Map(history.map((r) => [r.sessionId, r]));

    // Running = fresh registry truth (works even with no watcher), enriched from DB.
    const running = reg.map((inst) => {
      const dbRow = dbById.get(inst.sessionId);
      return {
        sessionId: inst.sessionId, name: inst.name ?? dbRow?.name ?? null,
        cwd: inst.cwd ?? dbRow?.cwd ?? null, status: inst.status,
        startedAt: inst.startedAt ?? dbRow?.startedAt ?? null,
      };
    });
    const recentlyEnded = history.filter((r) => r.endedAt !== null && !regIds.has(r.sessionId));

    if (running.length === 0 && recentlyEnded.length === 0) {
      console.log("No running or recently-ended Claude Code sessions.");
      console.log(kleur.dim("Install the watcher to keep this across restarts: ccaudit watch --install"));
      return;
    }

    if (running.length) {
      console.log(kleur.bold(kleur.green(`● Running now (${running.length})`)));
      const headers = ["DIR", "NAME", "STATUS", "STARTED"];
      const data = running.map((r) => [
        r.cwd ?? "—", (r.name ?? "—").slice(0, 32), r.status ?? "—",
        r.startedAt ? relativeTime(r.startedAt, now) : "—",
      ]);
      const widths = headers.map((h, i) => Math.max(h.length, ...data.map((d) => d[i]!.length)));
      console.log(kleur.dim(row(headers, widths)));
      for (const d of data) console.log(row(d, widths));
      console.log();
      console.log(kleur.dim("Resume:"));
      for (const r of running) {
        const cwd = r.cwd && existsSync(r.cwd) ? r.cwd : null;
        console.log(kleur.dim("  " + buildResumeCommand(r.sessionId, cwd).replace("\n", "  ")));
      }
    }

    if (recentlyEnded.length) {
      console.log();
      console.log(kleur.bold(kleur.yellow(`○ Recently ended (${recentlyEnded.length})`)));
      for (const r of recentlyEnded) {
        const when = r.endedReason === "restart" ? "ended at your last restart" : `ended ${relativeTime(r.endedAt, now)}`;
        console.log(`  ${kleur.dim(r.cwd ?? "—")}  ${r.name ?? ""}  ${kleur.dim("· " + when)}`);
      }
    }
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Build + smoke**

Run: `npm run build:cli && node dist/index.js live`
Expected: a "● Running now (N)" table whose N matches your live sessions, each with a `cd … claude --resume …` line; plus any "○ Recently ended" rows. (If the watcher has never run, recently-ended may be empty — that's correct.)

- [ ] **Step 3: Commit**

```bash
git add src/cli/live.ts
git commit -m "feat(cli): ccaudit live — running + recently-ended sessions table"
```

---

## Task 11: Serve install-UX (`--watch` / `--no-watch` / TTY prompt)

**Files:**
- Modify: `src/cli/serve.ts` (add the prompt flow)
- Modify: `src/cli/index.ts` (add the two options to the `serve` command)

Integration; the units it calls (config, launchd) are tested. The flow is verified by manual smoke.

- [ ] **Step 1: Add the options to the serve command**

In `src/cli/index.ts`, in the `serve` command block (lines 18-23), add two options before `.action(serveCommand)`:

```ts
  .option("--watch", "install the background session watcher without prompting")
  .option("--no-watch", "skip the watcher and don't prompt again")
```

So the block reads:

```ts
program
  .command("serve", { isDefault: true })
  .description("Start the browser UI (default when no subcommand given)")
  .option("--port <n>", "server port", "4321")
  .option("--no-open", "don't auto-open browser")
  .option("--watch", "install the background session watcher without prompting")
  .option("--no-watch", "skip the watcher and don't prompt again")
  .action(serveCommand);
```

> Commander maps `--watch`/`--no-watch` to a single tri-state `opts.watch`: `true` (--watch), `false` (--no-watch), `undefined` (neither).

- [ ] **Step 2: Add the prompt helper + flow to serve.ts**

In `src/cli/serve.ts`, add imports at the top (after the existing `port.js` import on line 9):

```ts
import { createInterface } from "node:readline";
import { join } from "node:path";
import { readConfig, writeConfig } from "../lib/config.js";
import { installAgent, agentInstalled } from "../lib/launchd.js";
import { LOGS_DIR } from "../paths.js";
```

> `join` is already imported on line 3 (`from "node:path"`). Add only the names not already imported — i.e. do **not** re-import `join`; add `createInterface`, the config functions, the launchd functions, and `LOGS_DIR`. (`LOGS_DIR` is a new symbol from `paths.js`; the existing import already pulls `INDEX_DB_PATH, CLAUDE_PROJECTS_DIR` — extend that line to also import `LOGS_DIR`.)

Concretely, change line 10 from:
```ts
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR } from "../paths.js";
```
to:
```ts
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR, LOGS_DIR } from "../paths.js";
```
and add (anywhere in the import block):
```ts
import { createInterface } from "node:readline";
import { readConfig, writeConfig } from "../lib/config.js";
import { installAgent, agentInstalled } from "../lib/launchd.js";
```

Add this helper function below `packageRoot()` (after line 16):

```ts
function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "" || a === "y" || a === "yes"); // default Yes
    });
  });
}

/**
 * Decide whether to install the running-session watcher, asking at most once.
 * --watch installs; --no-watch records a decline; otherwise prompt only on an
 * interactive TTY (headless never prompts). macOS only — a no-op elsewhere.
 */
async function maybeOfferWatch(watch: boolean | undefined): Promise<void> {
  if (process.platform !== "darwin") return;
  const install = () => {
    try {
      installAgent({ nodePath: process.execPath, cliPath: process.argv[1] ?? "", logPath: join(LOGS_DIR, "watch.log") });
      writeConfig({ watch: "installed" });
      console.log(kleur.dim("✓ Background watcher installed — your running sessions now survive restarts. (ccaudit watch --uninstall to remove)"));
    } catch (e) {
      console.log(kleur.dim(`(couldn't install the watcher: ${(e as Error).message})`));
    }
  };

  if (watch === true) { if (!agentInstalled()) install(); return; }
  if (watch === false) { writeConfig({ watch: "declined" }); return; }

  const cfg = readConfig();
  if (agentInstalled() || cfg.watch === "installed" || cfg.watch === "declined") return; // asked already

  if (!process.stdin.isTTY) return; // headless: never prompt

  const yes = await askYesNo(kleur.bold("Track your running Claude Code sessions across restarts? ") + kleur.dim("[Y/n] "));
  if (yes) install();
  else { writeConfig({ watch: "declined" }); console.log(kleur.dim("Skipped. Re-run `ccaudit watch --install` any time.")); }
}
```

Now call it in `serveCommand`. Update the signature and add the call after the port check (after line 34, before the `console.log(kleur.bold("ccaudit") ...)` header on line 36):

Change line 18 from:
```ts
export async function serveCommand(opts: { port?: string; open?: boolean }): Promise<void> {
```
to:
```ts
export async function serveCommand(opts: { port?: string; open?: boolean; watch?: boolean }): Promise<void> {
```

Add immediately after the port-conflict block (after line 34's closing `}`):

```ts
  await maybeOfferWatch(opts.watch);
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build:cli 2>&1 | tail -5`
Expected: no TypeScript/tsup errors.

- [ ] **Step 4: Manual smoke (headless + flags)**

Run: `printf 'n\n' | node dist/index.js serve --port 4399 --no-open` then Ctrl-C after it starts.
Expected: no crash; with `--no-watch` no prompt appears, with neither flag on a TTY the `Track your running…? [Y/n]` line appears once. Verify the decision persisted:

Run: `cat ~/.ccaudit/config.json`
Expected: contains `"watch": "declined"` (after answering `n` or passing `--no-watch`).

> Clean up before re-testing the prompt: `rm -f ~/.ccaudit/config.json` resets the "asked once" state.

- [ ] **Step 5: Commit**

```bash
git add src/cli/serve.ts src/cli/index.ts
git commit -m "feat(serve): one-time opt-in to install the session watcher (TTY-only, --watch/--no-watch)"
```

---

## Task 12: `GET /api/live` route

**Files:**
- Create: `src/pages/api/live.ts`

SSR route; verified via curl in the manual step. (Astro routes aren't unit-tested in this repo — see `tests/astro-smoke.test.ts` for the dev-server smoke pattern; we add a manual curl check instead.)

- [ ] **Step 1: Implement the route**

Create `src/pages/api/live.ts`:

```ts
import type { APIRoute } from "astro";
import { existsSync } from "node:fs";
import { getDb } from "../../db/init.js";
import { readLiveRegistry } from "../../watch/registry.js";
import { listLive, indexedSessionIds } from "../../db/live-sessions.js";
import { getBootTime } from "../../lib/boot-time.js";

const DAY = 86_400_000;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export const GET: APIRoute = () => {
  const now = Date.now();
  const db = getDb();
  const reg = readLiveRegistry({ bootTime: getBootTime(now) });
  const regIds = new Set(reg.map((r) => r.sessionId));
  const history = listLive(db, { endedSince: now - DAY });
  const dbById = new Map(history.map((r) => [r.sessionId, r]));

  const allIds = [...new Set([...reg.map((r) => r.sessionId), ...history.map((r) => r.sessionId)])];
  const indexed = indexedSessionIds(db, allIds);

  // Running = fresh registry truth (fresh even between watcher ticks / no watcher), enriched from DB.
  const running = reg.map((inst) => {
    const d = dbById.get(inst.sessionId);
    const cwd = inst.cwd ?? d?.cwd ?? null;
    return {
      sessionId: inst.sessionId,
      name: inst.name ?? d?.name ?? null,
      cwd,
      cwdExists: !!cwd && existsSync(cwd),
      status: inst.status,
      startedAt: inst.startedAt ?? d?.startedAt ?? null,
      lastSeen: d?.lastSeen ?? inst.updatedAt ?? now,
      isIndexed: indexed.has(inst.sessionId),
    };
  });

  const recentlyEnded = history
    .filter((r) => r.endedAt !== null && !regIds.has(r.sessionId))
    .map((r) => ({
      sessionId: r.sessionId, name: r.name, cwd: r.cwd,
      cwdExists: !!r.cwd && existsSync(r.cwd),
      endedAt: r.endedAt, endedReason: r.endedReason, lastSeen: r.lastSeen,
      isIndexed: indexed.has(r.sessionId),
    }));

  return json({ running, recentlyEnded });
};
```

- [ ] **Step 2: Build the web bundle**

Run: `npm run build:web 2>&1 | tail -8`
Expected: astro build succeeds and lists `/api/live` among the built routes.

- [ ] **Step 3: Manual curl smoke**

Start the server (`node dist/index.js serve --port 4399 --no-open --no-watch`) in one shell, then:
Run: `curl -s http://127.0.0.1:4399/api/live | head -c 400`
Expected: JSON `{"running":[...],"recentlyEnded":[...]}`; `running` length matches your live `~/.claude/sessions/*.json` count, each item carrying `sessionId`, `cwd`, `status`, `isIndexed`. Stop the server afterward.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/live.ts
git commit -m "feat(web): GET /api/live — running + recently-ended (on-demand + history merge)"
```

---

## Task 13: `/live` page

**Files:**
- Create: `src/pages/live.astro`

- [ ] **Step 1: Implement the page**

Create `src/pages/live.astro` (mirrors `projects.astro`'s AppShell+Sidebar structure; data is SSR'd from the same merge as the API):

```astro
---
import AppShell from "../layouts/AppShell.astro";
import Sidebar from "../components/Sidebar.astro";
import { existsSync } from "node:fs";
import { getDb } from "../db/init";
import { getLibraryTree } from "../db/library";
import { listTopics } from "../db/topics";
import { resolveRange } from "../db/date-range";
import { readLiveRegistry } from "../watch/registry";
import { listLive, indexedSessionIds } from "../db/live-sessions";
import { getBootTime } from "../lib/boot-time";
import { agentInstalled } from "../lib/launchd";
import { buildResumeCommand } from "../lib/resume";
import { relativeTime } from "../lib/render";

const now = Date.now();
const DAY = 86_400_000;
const range = resolveRange(Astro.cookies.get("ccaudit-range")?.value, now);
const db = getDb();
const tree = getLibraryTree(db, range);
const topics = listTopics(db, range);

const reg = readLiveRegistry({ bootTime: getBootTime(now) });
const regIds = new Set(reg.map((r) => r.sessionId));
const history = listLive(db, { endedSince: now - DAY });
const dbById = new Map(history.map((r) => [r.sessionId, r]));
const indexed = indexedSessionIds(db, [...new Set([...reg.map((r) => r.sessionId), ...history.map((r) => r.sessionId)])]);

const running = reg.map((inst) => {
  const d = dbById.get(inst.sessionId);
  const cwd = inst.cwd ?? d?.cwd ?? null;
  return {
    sessionId: inst.sessionId, name: inst.name ?? d?.name ?? null, cwd,
    status: inst.status, startedAt: inst.startedAt ?? d?.startedAt ?? null,
    isIndexed: indexed.has(inst.sessionId),
    resumeCmd: buildResumeCommand(inst.sessionId, cwd && existsSync(cwd) ? cwd : null),
  };
});
const recentlyEnded = history
  .filter((r) => r.endedAt !== null && !regIds.has(r.sessionId))
  .map((r) => ({
    ...r, isIndexed: indexed.has(r.sessionId),
    resumeCmd: buildResumeCommand(r.sessionId, r.cwd && existsSync(r.cwd) ? r.cwd : null),
  }));

const watcherOn = agentInstalled();
const short = (s: string) => s.slice(0, 8);
---
<AppShell title="ccaudit — live">
  <Sidebar slot="sidebar" tree={tree} topics={topics} />
  <div slot="reader" class="p-8 max-w-[1000px]">
    <h1 class="font-serif text-2xl font-semibold mb-1" style="color:var(--text);">Live sessions</h1>
    <p class="text-[13px] mb-5" style="color:var(--text-dim);">
      Claude Code instances running on this machine, read live from <code class="font-mono-w">~/.claude/sessions</code>.
      {watcherOn
        ? <span> The background watcher is on, so these survive restarts.</span>
        : <span> Install the background watcher to keep this across restarts: <code class="font-mono-w" style="color:var(--amber-bright);">ccaudit watch --install</code></span>}
    </p>

    <div class="flex items-center gap-2 mb-2">
      <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:var(--c-green);"></span>
      <h2 class="font-serif text-[17px] font-semibold" style="color:var(--text);">Running now <span style="color:var(--text-faint);">({running.length})</span></h2>
    </div>
    {running.length === 0 && <p class="text-[13px] mb-6" style="color:var(--text-faint);">Nothing running right now.</p>}
    {running.length > 0 && (
      <div class="rounded-xl mb-7" style="background:var(--panel); border:1px solid var(--border-soft);">
        {running.map((r) => (
          <div class="px-4 py-3" style="border-bottom:1px solid var(--border-soft);">
            <div class="flex items-center gap-2 min-w-0">
              <span class="truncate font-medium" style="color:var(--text);">{r.name ?? short(r.sessionId)}</span>
              {r.status && <span class="text-[11px] px-1.5 py-0.5 rounded" style="background:var(--raise); color:var(--text-dim);">{r.status}</span>}
              <span class="ml-auto text-[11.5px]" style="color:var(--text-faint);">{r.startedAt ? `up ${relativeTime(r.startedAt, now)}` : ""}</span>
            </div>
            <div class="text-[12px] mt-0.5 font-mono-w truncate" style="color:var(--text-dim);">{r.cwd ?? "cwd unknown"}</div>
            <div class="flex items-center gap-3 mt-1.5">
              <button class="resume-btn" data-cmd={r.resumeCmd}>Copy resume</button>
              {r.isIndexed && <a href={`/s/${r.sessionId}`} class="text-[12px]" style="color:var(--amber-bright);">Open transcript →</a>}
            </div>
          </div>
        ))}
      </div>
    )}

    <div class="flex items-center gap-2 mb-2">
      <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:var(--text-faint);"></span>
      <h2 class="font-serif text-[17px] font-semibold" style="color:var(--text);">Recently ended <span style="color:var(--text-faint);">({recentlyEnded.length})</span></h2>
    </div>
    {recentlyEnded.length === 0 && <p class="text-[13px]" style="color:var(--text-faint);">No sessions have ended in the last 24h{watcherOn ? "" : " that the watcher recorded"}.</p>}
    {recentlyEnded.length > 0 && (
      <div class="rounded-xl" style="background:var(--panel); border:1px solid var(--border-soft);">
        {recentlyEnded.map((r) => (
          <div class="px-4 py-3" style="border-bottom:1px solid var(--border-soft);">
            <div class="flex items-center gap-2 min-w-0">
              <span class="truncate font-medium" style="color:var(--text-dim);">{r.name ?? short(r.sessionId)}</span>
              <span class="ml-auto text-[11.5px]" style="color:var(--text-faint);">
                {r.endedReason === "restart" ? "ended at your last restart" : `ended ${relativeTime(r.endedAt, now)}`}
              </span>
            </div>
            <div class="text-[12px] mt-0.5 font-mono-w truncate" style="color:var(--text-dim);">{r.cwd ?? "cwd unknown"}</div>
            <div class="flex items-center gap-3 mt-1.5">
              <button class="resume-btn" data-cmd={r.resumeCmd}>Copy resume</button>
              {r.isIndexed && <a href={`/s/${r.sessionId}`} class="text-[12px]" style="color:var(--amber-bright);">Open transcript →</a>}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
</AppShell>

<style>
  .resume-btn { font-size: 12px; padding: 2px 9px; border-radius: 6px; cursor: pointer;
    background: var(--canvas); color: var(--text-dim); border: 1px solid var(--border); }
  .resume-btn:hover { color: var(--text); border-color: var(--amber); }
</style>

<script>
  // Copy the two-line resume snippet to the clipboard.
  document.querySelectorAll<HTMLButtonElement>(".resume-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cmd = btn.dataset.cmd ?? "";
      try { await navigator.clipboard.writeText(cmd); const t = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(() => (btn.textContent = t), 1200); }
      catch { /* clipboard unavailable */ }
    });
  });
</script>
```

> Confirm the transcript route prefix. `src/pages/s/` exists (`src/pages/s/[id]`); use `/s/<id>`. If your route differs, match it — check `ls src/pages/s/`.

- [ ] **Step 2: Verify the route param + build**

Run: `ls src/pages/s/ && npm run build:web 2>&1 | tail -8`
Expected: confirms the `/s/[id]` transcript route exists and lists `/live` among built routes with no errors.

- [ ] **Step 3: Browser verification (per CLAUDE.md — client viz must be browser-verified)**

Start: `node dist/index.js serve --port 4399 --no-open --no-watch`. Then drive Playwright (offer to the user first, per CLAUDE.md) to `http://127.0.0.1:4399/live`:
- Wait for `h1` text "Live sessions" and for `text=/Running now/` to be present.
- Assert the "Running now (N)" count and that each running row shows a cwd line + a "Copy resume" button.
- Click a "Copy resume" button and assert its label flips to "Copied ✓".
- Screenshot to `/tmp/ccaudit-live.png`.

Expected: page renders the live sessions (not a loading screen); count matches `curl /api/live`. Report the screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/pages/live.astro
git commit -m "feat(web): /live page — running + recently-ended with copy-resume"
```

---

## Task 14: Sidebar "Running now" + Live nav + client poll

**Files:**
- Modify: `src/components/Sidebar.astro`

The "Running now (N)" section is populated entirely client-side (a 15s poll of `/api/live`) so no new props need threading through every page that renders the Sidebar.

- [ ] **Step 1: Add the Live nav entry**

In `src/components/Sidebar.astro`, in the Library nav block, add a "Live" link after the "Ask history" link (currently line 53):

```astro
    <a href="/live" class="lib-item" title="Running sessions"><span class="ico">◉</span><span class="lbl-t">Live</span> <span id="live-nav-count" class="ml-auto text-[11px] rail-hide" style="color:var(--c-green); display:none;"></span></a>
```

- [ ] **Step 2: Add the "Running now" section markup**

Immediately after the Library nav links (after the new Live link, before the `<div class="rail-hide">` that opens the Topics block on line 55), insert:

```astro
    <div id="running-now" class="rail-hide" style="display:none;">
      <div class="text-[10.5px] tracking-wider uppercase px-2.5 pt-3.5 pb-1.5 font-semibold" style="color:var(--text-faint);">
        Running now <span id="running-now-count"></span>
      </div>
      <div id="running-now-list"></div>
    </div>
```

- [ ] **Step 3: Add the poll script**

At the very end of `src/components/Sidebar.astro` (after the existing markup/scripts), add a new `<script>` block:

```astro
<script>
  // Light poll of /api/live to keep the sidebar "Running now" list current while a page is open.
  function shortId(s: string) { return s.slice(0, 8); }
  async function refreshRunning() {
    let data: { running: Array<{ sessionId: string; name: string | null; cwd: string | null; isIndexed: boolean }> };
    try { const res = await fetch("/api/live"); if (!res.ok) return; data = await res.json(); }
    catch { return; }
    const running = data.running ?? [];
    const section = document.getElementById("running-now");
    const list = document.getElementById("running-now-list");
    const count = document.getElementById("running-now-count");
    const navCount = document.getElementById("live-nav-count");
    if (navCount) { navCount.textContent = running.length ? `● ${running.length}` : ""; navCount.style.display = running.length ? "" : "none"; }
    if (!section || !list || !count) return;
    if (running.length === 0) { section.style.display = "none"; list.innerHTML = ""; return; }
    section.style.display = "";
    count.textContent = `(${running.length})`;
    list.innerHTML = running.map((r) => {
      const label = (r.name || shortId(r.sessionId)).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
      const href = r.isIndexed ? `/s/${r.sessionId}` : "/live";
      return `<a href="${href}" class="lib-item" title="${label}"><span class="w-2 h-2 rounded-full inline-block" style="background:var(--c-green);"></span><span class="truncate">${label}</span></a>`;
    }).join("");
  }
  refreshRunning();
  setInterval(refreshRunning, 15000);
</script>
```

- [ ] **Step 4: Build + browser-verify the sidebar count**

Run: `npm run build:web 2>&1 | tail -5` (expect no errors).

Then with the server running, Playwright-verify (per CLAUDE.md) that on any page (e.g. `/`) the sidebar shows a "Running now (N)" section and the "Live" nav item shows a `● N` badge matching `/api/live`. Poll for `#running-now-list a` count > 0 (or confirm the section is hidden when N=0). Screenshot `/tmp/ccaudit-sidebar-live.png`.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.astro
git commit -m "feat(web): sidebar Running-now section + Live nav badge (15s poll)"
```

---

## Task 15: Full-suite green + end-to-end restart verification

**Files:** none (verification + docs).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test 2>&1 | tail -20`
Expected: all tests pass (the prior count plus the ~7 new files / ~25 new cases). Fix any regressions before proceeding.

- [ ] **Step 2: Full typecheck + build**

Run: `npm run build 2>&1 | tail -15`
Expected: `tsup` and `astro build` both succeed with no errors.

- [ ] **Step 3: End-to-end watcher install + tick + status (macOS)**

```bash
node dist/index.js watch --install     # expect ✓ Installed … (com.ccaudit.watch)
launchctl list | grep com.ccaudit.watch  # expect a line (loaded)
sleep 35                                # let one interval fire
node dist/index.js watch --status       # Installed: yes · Running now: N · Last update: <recent>
tail -3 ~/.ccaudit/logs/watch.log       # expect "tick — running=N endedNow=M" lines
node dist/index.js live                 # running table matches your open sessions
```
Expected: the watcher loads, ticks within ~30s, `watch --status` shows it installed with a recent "Last update", and `live` lists your running sessions. Confirm nothing was written under `~/.claude` (only `~/.ccaudit`).

- [ ] **Step 4: Simulate a vanished session (the core promise)**

In a scratch dir, start a throwaway instance, confirm it appears, kill it, and confirm it flips to ended:
```bash
node dist/index.js live                 # note a running session's dir
# (kill that Claude instance, or quit a terminal running `claude`)
sleep 35                                # wait for the next tick
node dist/index.js live                 # it should now appear under "Recently ended · ended Xm ago"
```
Expected: the killed instance moves from "Running now" to "Recently ended" with reason `exited` (not `restart`, since it died after boot). This proves the liveness reconcile works without `ps` scraping.

- [ ] **Step 5: Clean up the test watcher (optional) + commit the plan completion**

```bash
node dist/index.js watch --uninstall    # if you don't want to keep it loaded during dev
git add -A
git commit -m "test(watch): full-suite green + manual restart/exit verification notes"
```

> The `--uninstall` is optional — keeping it installed is the intended end state for a real user. Uninstall only resets your dev machine.

---

## Self-Review

**Spec coverage:**
- §1 Registry reader → Task 2 ✓ (`readLiveRegistry`, injectable `dir`/`isAlive`, malformed-skip, liveness filter).
- §2 Paths (`CLAUDE_SESSIONS_DIR` + `CCAUDIT_SESSIONS_DIR` override) → Task 1 ✓ (plus `CONFIG_PATH`).
- §3 Data model (`live_sessions` schema) + DB ops (`upsertLive`/`markEnded`/`listLive`) → Task 3 ✓ (added `indexedSessionIds` for the `isIndexed` flag).
- §4 Tick/reconcile + boot time → Tasks 4 & 5 ✓ (restart vs exited, PID reuse, idempotent).
- §5 launchd (`buildPlist` + install/uninstall) + `watch`/`watch-tick` CLI + platform guard → Tasks 8 & 9 ✓.
- §6 Serve install UX (`--watch`/`--no-watch`/TTY prompt/headless-never-prompt/config persistence) → Task 11 ✓.
- §7 UI (`/api/live`, `/live`, Sidebar "Running now", Live nav, on-demand+history merge, `isIndexed`, shared resume builder) → Tasks 7, 12, 13, 14 ✓.
- §8 `live` CLI + registration → Tasks 9 & 10 ✓.
- §Testing (registry, runWatchTick, buildPlist, live-sessions ops, resume builder) → Tasks 2,3,5,7,8 ✓; install/launchctl/TTY covered by manual smoke (Tasks 9, 11, 15) per the spec.
- §Edge cases (stale pid file, PID reuse, multiple per cwd, watcher-not-installed, malformed file, non-macOS, headless) → covered across Tasks 2, 3, 5, 11, 13.

**PoC-driven correction (2026-06-01):** A live PoC against the real `~/.claude/sessions` registry confirmed the tracking chain (liveness flips on real process death; 9/10 `sessionId`s join the index; a just-started session is correctly *not yet* indexed → `isIndexed:false`). It also disproved the spec's "registry is empty after reboot" assumption: the files survive reboots. Fix folded into Task 2 — `readLiveRegistry({ bootTime })` drops any entry whose `startedAt < bootTime` (a live session always starts after boot), threaded into the tick (Task 9), `live` CLI (Task 10), `/api/live` (Task 12), and `/live` page (Task 13). All readers pass `getBootTime()`.

**Type consistency:** `LiveInstance` (Task 2) ← consumed by `upsertLive` (Task 3) and `runWatchTick` (Task 5). `LiveRow` (Task 3) ← consumed by `listLive` callers (Tasks 9, 10, 12, 13). `buildResumeCommand(sessionId, cwd)` signature identical across Tasks 7, 10, 12, 13. `WATCH_LABEL`/`buildPlist`/`installAgent`/`agentInstalled`/`uninstallAgent` (Task 8) used consistently in Tasks 9 & 11. `getBootTime`/`parseDarwinBoottimeSec` (Task 4) used in Tasks 5(test) & 9. `readConfig`/`writeConfig` (Task 6) used in Tasks 9 & 11. Commander tri-state `opts.watch` consistent between Task 11's option defs and the `serveCommand` signature.

**Placeholder scan:** none — every code step contains complete source; manual-verification steps give exact commands + expected output.

**Ordering note:** Tasks 9 and 10 both touch `src/cli/index.ts` imports; the plan flags doing them back-to-back and building once to avoid a transient missing-import. Task 11 extends the same file's `serve` block — independent of the 9/10 imports.
