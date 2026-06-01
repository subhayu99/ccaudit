# ccaudit — Running-Session Monitoring (design)

**Date:** 2026-06-01
**Status:** Approved design → ready for an implementation plan (writing-plans).

## Problem

The user runs many Claude Code instances at once across different directories (worktrees, projects). Terminals don't survive a machine restart — on reboot the shells are force-killed and the user loses track of *what was running and where*. ccaudit already indexes every session's history, but it has no notion of which sessions were **live** at a given moment, so it can't answer "what did I have open before the restart, and how do I get back to it?"

## Goal

Track Claude Code's **running** sessions, persist that across machine restarts, detect when an instance ends, and surface a "running now / recently ended" view with one-click resume — all locally, never writing to `~/.claude`.

## Key discovery (feasibility PoC, 2026-05-31)

Claude Code maintains a **live session registry** at `~/.claude/sessions/<pid>.json`, one file per running instance. Observed fields (v2.1.x):

```json
{ "pid": 96794, "sessionId": "e4929da6-…", "cwd": "/Users/subhayu/Documents",
  "startedAt": 1780001577769, "procStart": "Thu May 28 20:52:57 2026",
  "version": "2.1.154", "kind": "interactive", "entrypoint": "cli",
  "status": "waiting", "waitingFor": "permission prompt",
  "name": "code-visualization-sync-panel", "updatedAt": 1780311075345,
  "bridgeSessionId": null, "peerProtocol": 1 }
```

`sessionId` joins straight into ccaudit's existing `sessions` index. Files exist only while the process is alive (they vanish/go stale on exit), so **restart-survival requires ccaudit to snapshot this registry into `~/.ccaudit` while sessions are running.** No `ps` scraping is needed. (Corroborating-but-secondary signals, not used as the primary source: `claude --resume <id>` shows the id in the `ps` command line; `lsof -a -p <pid> -d cwd` yields a cwd; `~/.claude/ide/*.lock` only exists for connected IDE extensions.) See memory `claude-live-session-registry`.

## Architecture overview

```
launchd LaunchAgent (StartInterval ~30s, RunAtLoad)
        │  every tick
        ▼
ccaudit watch-tick ── reads ~/.claude/sessions/*.json (read-only)
        │            ── checks each pid liveness (process.kill(pid,0))
        │            ── reconciles into ~/.ccaudit/index.db (live_sessions)
        ▼
live_sessions table ──► Web UI ("Running now" sidebar + /live page) and `ccaudit live`
```

The watcher is the only new always-scheduled piece, and it is **not a resident daemon** — launchd spawns a short-lived tick every interval; between ticks there is zero footprint. The Web UI can *also* read the registry on demand (so the live view works even with no watcher installed); the watcher is what makes the data **survive a restart**.

## Components

### 1. Registry reader — `src/watch/registry.ts`
- `type LiveInstance = { pid; sessionId; cwd; name; status; waitingFor?; version; startedAt; updatedAt }`.
- `readLiveRegistry(opts?: { dir?; isAlive?: (pid)=>boolean }): LiveInstance[]` — reads `*.json` in the sessions dir, parses (tolerating malformed/partial files), and keeps only entries whose `pid` is alive. `dir` and `isAlive` are injectable for tests. Default `isAlive` = `process.kill(pid, 0)` in a try/catch (true unless it throws ESRCH).
- Pure I/O, deterministic under injection → unit-testable with a temp fixture dir.

### 2. Paths — `src/paths.ts`
- Add `CLAUDE_SESSIONS_DIR = process.env.CCAUDIT_SESSIONS_DIR || join(home(), ".claude", "sessions")` (mirrors the existing `CCAUDIT_PROJECTS_DIR` override so tests/demo can point elsewhere).

### 3. Data model — `src/db/init.ts` + `src/db/live-sessions.ts`
New table (added to the init schema):
```sql
CREATE TABLE IF NOT EXISTS live_sessions (
  session_id   TEXT PRIMARY KEY,
  pid          INTEGER,
  cwd          TEXT,
  name         TEXT,
  status       TEXT,
  version      TEXT,
  started_at   INTEGER,      -- ms, from the registry (guards PID reuse)
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  ended_at     INTEGER,      -- NULL = currently running
  ended_reason TEXT          -- 'exited' | 'restart' (NULL while running)
);
CREATE INDEX IF NOT EXISTS idx_live_last_seen ON live_sessions(last_seen DESC);
```
`src/db/live-sessions.ts` exports:
- `upsertLive(db, inst, now)` — insert or refresh a running row (set `last_seen=now`, `status`, clear `ended_at`/`ended_reason`); if an existing row has a different `started_at`, treat as a new session (overwrite — old PID was reused).
- `markEnded(db, sessionId, at, reason)`.
- `listLive(db, { includeEndedSince? })` — running rows first (by `last_seen`), then recently-ended.

### 4. Tick / reconcile — `src/watch/tick.ts`
`runWatchTick(db, { now, bootTime, registry })` (deps injectable for tests):
1. `const live = registry()` (from `readLiveRegistry`).
2. Upsert every live instance.
3. For each DB row with `ended_at IS NULL` whose `session_id` is **not** in `live`: `markEnded(now)`; `ended_reason = (row.last_seen < bootTime) ? 'restart' : 'exited'`.
4. Return a small summary (counts) for `--status`/logging.

`bootTime` via `src/lib/boot-time.ts`: macOS `sysctl -n kern.boottime`; Linux `Date.now() - uptime(/proc/uptime)*1000`; fallback `0` (→ everything counts as `exited`).

### 5. Watcher install — `src/lib/launchd.ts` + `src/cli/watch.ts`
- `src/lib/launchd.ts`: pure `buildPlist({ label, nodePath, cliPath, interval }): string` (testable XML), plus `installAgent()/uninstallAgent()/agentStatus()` that write/remove `~/Library/LaunchAgents/com.ccaudit.watch.plist` and run `launchctl bootstrap/bootout`. Label `com.ccaudit.watch`. The plist's `ProgramArguments` = `[nodePath, cliPath, "watch-tick"]`, `StartInterval` 30, `RunAtLoad true`, logs to `~/.ccaudit/logs/watch.log`.
- `src/cli/watch.ts`:
  - `ccaudit watch --install` / `--uninstall` / `--status` (status: installed? last tick time, # running, # ended-today).
  - `ccaudit watch-tick` (internal/hidden command launchd calls) → `runWatchTick`.
- Platform guard: on non-macOS, `--install` prints "launchd watcher is macOS-only for now; the live view still works while ccaudit is open" (Linux systemd timer is a follow-up).

### 6. Install UX in `serve` — `src/cli/serve.ts`
- New options: `--watch` (install without prompting) / `--no-watch` (skip + remember, no prompt).
- Flow on `serve` start (after the port check, before/around indexing):
  - If `--watch` → install (if not already), no prompt.
  - Else if `--no-watch` → record "declined", no prompt.
  - Else if the agent is already installed OR a prior decision is recorded → do nothing.
  - Else if **`process.stdin.isTTY`** → prompt `Track your running Claude Code sessions across restarts? [Y/n]` (default **Yes**). Install on yes; record the decision either way (ask once).
  - Else (**non-interactive / headless**) → **never prompt**; do nothing.
- The decision is persisted in `~/.ccaudit/config.json` (`{ "watch": "installed" | "declined" }`) via a new minimal `src/lib/config.ts` (`readConfig()/writeConfig(patch)`, best-effort JSON), so it's asked once.

### 7. UI — `src/pages/live.astro`, `src/pages/api/live.ts`, `src/components/Sidebar.astro`
- `GET /api/live` (APIRoute): returns `{ running: [...], recentlyEnded: [...] }` by merging an **on-demand** `readLiveRegistry()` read with the `live_sessions` history (so it's fresh even between ticks, and works with no watcher). Each row carries `sessionId, name, cwd, status, lastSeen, endedAt, endedReason, isIndexed` (whether the session exists in the index).
- `src/pages/live.astro`: a "Live" reader page — **Running now** (status dot, dir, name, last status text, uptime) and **Recently ended** (dir, ended-when, "ended at your last restart" when `ended_reason='restart'`). Each row: a **Resume** affordance reusing the existing `cd <posix-quoted cwd> && claude --resume <id>` snippet (factor the current `SessionReader` resume-command builder into a shared `src/lib/resume.ts`), and a link to the indexed transcript when `isIndexed`.
- `src/components/Sidebar.astro`: a compact "Running now (N)" section near the top, each item linking to `/live` (or directly to the session). Fed by a light client poll of `/api/live` (e.g. every 15s) so the count stays live while the page is open; hidden when N=0 and no watcher history.
- Add a `Live` nav entry. Warm-obsidian styling consistent with the rest; a small "install the background watcher to keep this across restarts" hint when the watcher isn't installed.

### 8. CLI — `src/cli/live.ts`, registered in `src/cli/index.ts`
- `ccaudit live` — prints a terminal table of running + recently-ended sessions (dir, name, status, last-seen, resume command).
- Register `watch`, `watch-tick`, `live` in `src/cli/index.ts`.

## Data flow (restart scenario)

1. Watcher ticks every ~30s while sessions run → `live_sessions` rows kept fresh (`last_seen` ≈ now, `ended_at` NULL).
2. User restarts the Mac. Shells die; the last tick before shutdown is the last `last_seen`.
3. On boot, launchd `RunAtLoad` fires a tick. The previously-running rows aren't in the (now empty/new) registry and their `last_seen < kern.boottime` → marked `ended_at=now, ended_reason='restart'`.
4. User opens ccaudit → **Recently ended** shows "7 sessions ended at your last restart," each with its dir, last status, and a resume command. Newly-started sessions appear under **Running now**.

## Edge cases

- **Stale `<pid>.json`** (process died, file lingers): the liveness check drops it from `readLiveRegistry`, so the tick marks it ended.
- **PID reuse**: keyed on `session_id`; a row whose `started_at` changes is overwritten as a new session.
- **Multiple sessions per cwd**: independent rows, keyed by `session_id`.
- **Watcher not installed**: live view is on-demand-only (no restart history); UI shows an install hint.
- **Malformed/partial registry file**: skipped (best-effort parse), logged to `~/.ccaudit/logs/watch.log`.
- **Non-macOS**: `--install` is a no-op with a clear message; live-while-open still works.
- **Headless**: no prompt ever; `--watch`/`--no-watch` give explicit control.

## Privacy / security

- `~/.claude/sessions/` is **read-only** to ccaudit (consistent with the existing read-only treatment of `~/.claude/projects/`). All writes go to `~/.ccaudit`.
- No network. The watcher only touches local files. The `cwd`/`name`/`status` it stores are the same data already in the index.

## Testing

- `readLiveRegistry` — temp fixture dir of `<pid>.json` + injected `isAlive`; asserts parse, liveness filtering, malformed-skip.
- `runWatchTick` — injected registry snapshots + `now`/`bootTime`; asserts running→ended transitions, `restart` vs `exited` classification, PID-reuse overwrite, no duplicate rows.
- `buildPlist` — snapshot the generated XML (label, interval, args, log path).
- `live-sessions` DB ops — upsert/markEnded/listLive ordering.
- Resume-command builder (shared) — quoting + format (reuse existing shell-quote tests).
- The launchd `installAgent`/`launchctl` calls and the TTY prompt are integration-y → covered by a manual verification step (and a thin smoke), not unit tests.

## Out of scope (future)

- Linux systemd user timer / Windows Task Scheduler watchers (design leaves a clean seam: only `launchd.ts` + the `watch --install` platform branch change).
- Push/desktop notifications on session end.
- Live token/cost of running sessions.

## Open questions

None blocking. Tick interval (30s) and the exact "recently ended" window (e.g. last 24h) are tunable defaults, not forks.
