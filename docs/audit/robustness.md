# ccaudit — Robustness & Edge-Case Audit

Focus: error handling, malformed/oversized JSONL, null/missing fields, `claude -p` failure modes, empty index, deleted-source sessions, path-decode quirk, concurrency, partial writes. Effort tags: S (≤30m), M (≤half day), L (≥1 day).

---

## P0 — Bugs / correctness / blocking

### P0-1. FTS5 `MATCH` crashes the CLI and MCP on ordinary user input
`src/db/messages.ts:91-119` (`searchMessages`) passes the raw query straight to `messages_fts MATCH @q`. FTS5 throws a `SqliteError: fts5: syntax error near ...` on perfectly normal input: a bare `"` , an unbalanced `(`, a trailing `AND`/`OR`/`NOT`, a leading `*`, or a column-filter like `foo:`. `src/pages/search.astro:22-30` wraps this in try/catch (renders `searchError`), but **`src/cli/search.ts:18` and `src/mcp/tools.ts:40` do not** — the CLI exits with an unhandled stack trace and the MCP tool returns a protocol error for queries like `ccaudit search 'foo"'` or `ccaudit search 'a OR'`.
**Fix:** Add an `escapeFtsQuery()` that wraps each whitespace-delimited term in double quotes (doubling internal `"`), e.g. `term.replace(/"/g,'""')` → `"…"`, joined by space; call it inside `searchMessages` before MATCH. This also makes results predictable (users rarely intend FTS boolean syntax). Alternatively wrap `searchMessages` calls in try/catch in the CLI/MCP and surface "invalid query". **Effort: S**

### P0-2. `Number(opts.limit)` produces `NaN` → SQLite `LIMIT NaN` error / silent empties
`src/cli/search.ts:18`, `src/cli/list.ts:11`, `src/cli/reindex.ts` consumers, and MCP all do `Number(opts.limit ?? N)`. `ccaudit search foo --limit abc` yields `NaN`; better-sqlite3 binding `LIMIT NaN` throws `TypeError: NaN`/`SqliteError`. `--limit -5` or `--limit 1e9` also pass through unchecked.
**Fix:** Replace with a clamped parse helper: `const n = Math.trunc(Number(opts.limit)); return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : DEFAULT;`. Apply in all three CLI commands and `src/mcp/tools.ts:35` (`limit`). **Effort: S**

### P0-3. `claude -p` not installed / not on PATH crashes label & cluster with raw ENOENT
`src/labeling/label-segments.ts:28` and `src/labeling/cluster-topics.ts:36` call `execFileSync("claude", …)`. If the `claude` binary is absent (very common for someone who installed ccaudit standalone), `execFileSync` throws `Error: spawn claude ENOENT`. The API routes (`api/label.ts:54`, `api/cluster.ts:29`) catch it and return `{error: "spawn claude ENOENT"}` with 500 — opaque to the user. Worse, there is no detection of the auth-required / rate-limit / non-zero-exit case beyond the JSON `is_error` flag, but a non-zero exit (auth failure, network) throws **before** JSON parsing, so `is_error` is never reached.
**Fix:** In a shared `runClaude()` wrapper: catch `err.code === "ENOENT"` → throw `new Error("claude CLI not found on PATH — install Claude Code to enable AI naming")`; catch `err.status` (non-zero exit, has `.stdout`/`.stderr`) → include trimmed stderr in the message; surface these strings in the UI button state. **Effort: M**

### P0-4. `claude -p` returns non-JSON → `JSON.parse` throws, unmodeled
`src/labeling/label-segments.ts:33` and `cluster-topics.ts:41` do `JSON.parse(raw)` on the subprocess stdout assuming `--output-format json`. If `claude` prints a banner, an update notice, an auth prompt to stdout, or anything non-JSON (happens on first-run/login flows), `JSON.parse` throws `SyntaxError: Unexpected token`. Caught only at the API layer as a 500.
**Fix:** Wrap the `JSON.parse(raw)` in try/catch; on failure throw `new Error("claude -p did not return JSON (got: " + raw.slice(0,120) + ")")`. Note the inner `o.result` is itself a JSON-array string parsed separately in `parseLabels`/`parseClusters` (those already fail soft to `[]`/`[]`), so only the outer envelope parse is the crash site. **Effort: S**

### P0-5. `claude -p` timeout aborts the whole request with no partial result
`label-segments.ts:31` sets `timeout: 180_000`, `cluster-topics.ts:39` sets `timeout: 600_000`. On timeout, `execFileSync` throws `ETIMEDOUT` (killed by SIGTERM). For clustering this is a 10-minute hang on the SSR thread holding an open DB handle; the user sees a spinner then a 500. Astro dev is single-process, so a long synchronous `execFileSync` **blocks the entire server** (no other page renders) for up to 10 minutes.
**Fix:** (a) Use `execFile`/async + `await` so the event loop isn't blocked, or spawn and stream; (b) on timeout return a structured `{error:"AI naming timed out"}` with 504; (c) lower cluster timeout or chunk the input. The synchronous-block-on-dev-server is the real severity here. **Effort: M**

### P0-6. Decoded `project_dir` is wrong for any path containing a dash → split repos / broken resume
`src/paths.ts:20-22` `decodeProjectDir` does `encoded.replace(/-/g, "/")`. The docstring honestly admits this is ambiguous, but the result is **stored as `project_dir` and used as a real path**: `index-runner.ts:97` writes it, and `api/sessions/[id]/resume.ts:17` falls back to it as the `cd` target when `cwd` is null. A real dir `/Users/x/my-project` decodes to `/Users/x/my/project`, so: (1) the sidebar shows a wrong/split tree, (2) the generated resume command `cd /Users/x/my/project` fails. The `cwd` from JSONL (`aggregate.ts:53`) is the correct path and *is* preferred when present — but sessions with no `cwd` line (older logs, compact-only) fall back to the broken decode.
**Fix:** Treat `decodeProjectDir` strictly as a *display label* (it already warns). For the resume `cd`, only emit it when `session.cwd` exists and `existsSync(cwd)`; otherwise emit `claude --resume <id>` without a `cd` and a note "original cwd unknown". For the tree, prefer grouping by resolved `cwd`. **Effort: M**

### P0-7. Resume command shell-injection / breakage on paths with spaces or special chars
`src/pages/api/sessions/[id]/resume.ts:18`: `` const command = `cd ${cwd}\nclaude --resume ${session.id}` ``. `cwd` is an unquoted, unescaped filesystem path. A path with a space (`/Users/x/My Projects/app`) produces `cd /Users/x/My Projects/app` which `cd`s to the wrong place; a path with `;`, `$()`, or `&&` (rare but possible in dir names) is a copy-paste command-injection into the user's own shell.
**Fix:** Single-quote the path with POSIX-safe escaping: `const q = "'" + cwd.replace(/'/g, "'\\''") + "'"; const command = \`cd ${q}\nclaude --resume ${session.id}\``. **Effort: S**

### P0-8. Regex search registers a SQLite function but ReDoS / pathological patterns can hang the server
`src/db/messages.ts:166-211` `searchMessagesRegex` compiles the user pattern and runs `ccaudit_regexp` per row over *every* `text_content` in the DB. A catastrophic-backtracking pattern (e.g. `(a+)+$`) against multi-KB tool-output rows will hang the synchronous SSR render indefinitely (no timeout, no row cap before the regex runs). On Astro dev this blocks all requests.
**Fix:** (a) Pre-filter with a `LIKE` on a literal substring of the pattern when derivable; (b) cap scanned rows (`LIMIT` a candidate set first); (c) consider running regex search behind a small worker with a time budget, or reject patterns over a complexity heuristic. Minimum: document and cap. **Effort: M**

### P0-9. `decodeProjectDir` mis-decodes hidden dirs and double-dash encodings (leading-dot, `--`)
`src/paths.ts:21`. Claude Code encodes a leading `/` as a leading `-`, and `.` in `.config` style dirs and consecutive path separators can yield `--`. `replace(/-/g,"/")` turns `--` into `//` (double-slash — the named "double-slash quirk"), so `project_dir` can contain `//`, and `projectLabel` (`paths.ts:26`, `split("/").filter(Boolean)`) silently drops the empty segment, masking the corruption while leaving `project_dir` with a literal `//`. Any equality/prefix logic on `project_dir` (exclusions `isExcludedPath`, indexes) then mismatches.
**Fix:** Normalize the decoded path by collapsing `//`→`/` before storing; and as in P0-6, prefer the real `cwd`. Add a test asserting no stored `project_dir` contains `//`. **Effort: S**

### P0-10. Empty/missing `~/.claude/projects` is handled, but empty *index* paths assume non-null aggregates in stats/dashboard
`walk.ts:15` returns `[]` when baseDir is missing (good). But several read paths assume at least one row. Verify `src/db/stats.ts` / `Dashboard.astro` for `MIN()/MAX()/AVG()` over zero rows returning `null` and being interpolated as `null`/`NaN`. (Could not fully read stats.ts under context budget — flagged for confirmation.)
**Fix:** Coalesce aggregates (`COALESCE(...,0)`) and guard the dashboard for the zero-session state with an empty-state panel. **Effort: S–M (confirm first)**

---

## P1 — UX / perf / quality

### P1-1. Malformed-line handling is solid but oversized single lines can OOM the parse
`src/indexer/parse.ts:19-31` streams line-by-line and fails soft per line (good — malformed JSON is counted and logged, not fatal). However `readline` buffers a full line in memory; a single pathological JSONL line (a multi-hundred-MB base64 image blob, which Claude Code does emit for pasted images) is read whole into a string and then `JSON.parse`d, spiking memory. `rawJson` is also stored verbatim in SQLite (`aggregate.ts:63`), so one huge line bloats the DB.
**Fix:** Cap `rawJson` length stored (e.g. truncate beyond ~256KB with a marker), and skip/extract-only for lines over a size threshold detectable from `line.length` before `JSON.parse`. **Effort: M**

### P1-2. `serve` blocks forever and leaks the Astro child on crash
`src/cli/serve.ts:36-66` spawns `npx astro dev` and `await new Promise(() => {})`. Cleanup only fires on SIGINT/SIGTERM (`:63-64`); if the parent throws after spawn or the child dies on its own, there's no `server.on("exit", …)` to detect/report it — the CLI just hangs. Also `spawn("npx", …)` resolves `npx` from PATH; if astro isn't installed the child errors but nothing surfaces it (no `error` listener).
**Fix:** Add `server.on("exit", code => { console.error("astro dev exited", code); process.exit(code ?? 1)})` and `server.on("error", …)`. **Effort: S**

### P1-3. `serve` runs a full `indexAll` synchronously before the server starts — slow first boot, no progress
`src/cli/serve.ts:24-33` indexes everything before printing the URL. For a large `~/.claude/projects` (thousands of sessions) this is a multi-second-to-minute blank wait with only "Indexing sessions…". `onProgress` is not passed here (it is in reindex).
**Fix:** Pass `onProgress` for incremental feedback, or start the server first and index in the background, marking the UI "indexing". **Effort: M**

### P1-4. Two browser tabs hitting `/api/cluster` or `/api/label` race; cluster does a full wipe-and-replace mid-read
`replaceTopics` (`src/db/topics.ts:7-19`) is atomic per transaction (good), but `api/cluster.ts` builds `items` from `getLibraryTree`, spends minutes in `claude -p`, then wipes all topics. A concurrent reindex or a second cluster invocation produces lost-update / duplicated work. There's no lock or in-flight guard. The `addToTopics` incremental path exists (`topics.ts:41`) but the API uses `replaceTopics`.
**Fix:** Add a simple advisory lock row (or in-process boolean) so concurrent cluster/label calls return 409 "already running". **Effort: M**

### P1-5. Every request opens and closes its own better-sqlite3 connection; no shared handle
`openDb(INDEX_DB_PATH)` is called per page render (`index.astro:20`, `search.astro:19`, `SessionReader.astro:17`, every API route) and runs the full `CREATE TABLE IF NOT EXISTS …` schema + `ALTER TABLE` probe (`init.ts:136-140`) on **every** open. Cheap individually but wasteful at scale and the per-open `db.function("ccaudit_regexp", …)` (only in regex path) is fine. WAL mode is on (good for concurrent readers + one writer).
**Fix:** Cache a singleton DB per process (module-level), run schema once. Astro SSR is long-lived so this is safe. **Effort: M**

### P1-6. Timestamp parsing accepts only ISO/number; bad timestamps silently null the whole ordering
`src/indexer/aggregate.ts:22-27` `parseTimestamp` returns null for unparseable strings (good — no crash), but a session where *every* line lacks a valid timestamp gets `startedAt=null, lastActivity=null`. `idx_sessions_last_activity` sorts these to the bottom/top unpredictably, and `list.ts:19` renders "—". This is acceptable, just note the ordering of null-timestamp sessions in the sidebar is undefined.
**Fix:** Fall back to `fileMtime` for `lastActivity` when null so ordering stays stable. **Effort: S**

### P1-7. `getSession` returning null for a deleted-source session shows an empty reader, not a clear message
`SessionReader.astro:23-27` renders `[]` messages when `session` is null (e.g. the row was indexed then the JSONL deleted and a force-reindex hasn't run, or a bad `?session=` id). The page mounts but shows nothing meaningful.
**Fix:** Render an explicit "session not found / source file removed — run `ccaudit reindex --force`" empty state when `!session`. **Effort: S**

### P1-8. Index errors are logged to a file the user never sees
`index-runner.ts:29-36` appends to `~/.ccaudit/logs/index-errors.log`. `reindex` reports counts (`malformedLines`, `errors`) but never points to the log. `serve` (`serve.ts:28-30`) reports only indexed/skipped, hiding malformed/error counts entirely.
**Fix:** Print the log path when `errors>0`, and surface malformed/error counts in `serve` output too. **Effort: S**

---

## P2 — Features / nice-to-have

### P2-1. `doctor` doesn't check the `claude` CLI availability or version
`src/cli/doctor.ts` checks projects dir + index db only. Since AI naming/clustering depend on `claude -p`, doctor should probe `claude --version` and report present/absent + auth status, so users diagnose P0-3/4/5 themselves.
**Fix:** Add a check running `execFile("claude",["--version"],{timeout:5000})`; report OK/missing. **Effort: S**

### P2-2. No global migration/version guard on the schema
`init.ts` uses `CREATE TABLE IF NOT EXISTS` + one ad-hoc `ALTER TABLE … ADD COLUMN cwd` probe (`:137-140`). Future column additions need the same hand-rolled probe; there's no `user_version` pragma. A DB from a newer ccaudit opened by an older binary won't be detected.
**Fix:** Use `PRAGMA user_version` with a small ordered migration list; set/check on open. **Effort: M**

### P2-3. `boundedEnds` token capture can split a repo whose history was rewritten / shallow-cloned
`src/identity/resolve.ts:64-99` keeps first/last 10 commits + root. Two clones that diverge in the middle but share old history still union (good), but a `git filter-repo`/rebase that rewrites the kept window, or a shallow clone (no root, truncated rev-list), yields disjoint token sets → the same logical repo splits into two components (`components.ts`). The remote fallback (`components.ts:76`) mitigates this *only if* a remote is configured.
**Fix:** Acceptable by design (documented), but consider also unioning on `manifestName` when no remote, or surfacing "possibly the same repo" hints. **Effort: L**

### P2-4. `git`/`claude` subprocess output capped by `maxBuffer`; huge histories silently truncate
`resolve.ts:44` caps git at 16MB, label at 16MB, cluster at 32MB. A monorepo with >~150k commits could exceed the git rev-list buffer → `execFileSync` throws `ENOBUFS`, caught as `null` by `defaultGitRunner` (`:48`), so the repo silently falls back to path identity. Rare but produces wrong grouping with no signal.
**Fix:** For rev-list specifically, page or `--max-count` the history (you only keep ends anyway — `git rev-list --max-count` from each end is cheaper and bound-safe). **Effort: M**

### P2-5. Exclusion add/remove never triggers a re-walk, so a newly-added project under an excluded prefix that's later un-excluded needs a manual reindex
By design exclusions are lossless/filter-only (`api/exclusions.ts` docstring, `index-runner.ts:54-60` skips indexing excluded paths). But a session created **while** a prefix was excluded is skipped at index time; un-excluding it later won't surface it until the next reindex picks up the (now-newer mtime) file — or never, if mtime is unchanged.
**Fix:** On `removeExclusion`, kick a targeted reindex of that prefix, or document that un-hiding may require `reindex --force`. **Effort: S**

---

## Things that are already good
- Per-line JSONL parsing fails soft and logs (`parse.ts`, `index-runner.ts:73-92`) — a single corrupt line never aborts a session, and a corrupt file is skipped, not fatal.
- Missing `~/.claude/projects` returns `[]` cleanly (`walk.ts:15`); `statSync` failures are swallowed per-entry.
- Index writes are transactional (`index-runner.ts:114-119`): upsert + delete-messages + insert are atomic, so a crash mid-write won't leave half a session.
- `replaceTopics` and `insertMessages` are wrapped in transactions — no partial topic/message state.
- Exclusion matching uses `substr/length` not `LIKE` (`exclusions.ts:45`), correctly avoiding `_`/`%` wildcard and sibling-prefix bugs.
- Remote normalization strips credentials and is well-tested in shape (`remote.ts`) — no token leakage into `repoId`.
- Union-find identity is order-independent/deterministic (`components.ts`) — good engineering.
- WAL mode + `foreign_keys=ON` + `ON DELETE CASCADE` give safe concurrent reads and clean deletes.
- Astro's CSRF posture: JSON POST endpoints rely on same-origin + JSON content-type (not form), correctly noted in `api/exclusions.ts`.
