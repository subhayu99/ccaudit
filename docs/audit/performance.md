# ccaudit — Performance & Scalability Audit

Scope: SSR render paths, DB connection lifecycle, N+1 queries, `getLibraryTree` rebuilds, FTS usage, graph payload sizes, large-session handling, caching. References are `file:line`. Effort tags: S (<1h), M (a few hours), L (a day+).

Baseline assumption used for "quantify": a heavy user has ~hundreds of workdirs, thousands of sessions, and sessions up to ~17k messages (the code's own stated worst case).

---

## P0 — Bugs / correctness / blocking

### P0-1. `openDb()` runs the full schema DDL + a PRAGMA introspection on **every** request
`src/db/init.ts:131-142`. Every SSR render (`index.astro:20`, `graph.astro:12`, `search.astro:19`, `SessionReader.astro:17`) calls `openDb()`, which does `mkdirSync`, `db.exec(SCHEMA)` (10 `CREATE TABLE IF NOT EXISTS` + 8 indexes + 3 triggers + a virtual FTS table), then `pragma("table_info(sessions)")` and a conditional `ALTER TABLE`. This is parsed and re-validated by SQLite on every page load, plus a fresh WAL handshake. The index page opens it once per request and also `SessionReader` opens a *second* connection in the same render (see P0-2).
**Fix:** Split connection-open from migration. Keep a process-wide singleton connection (module-level memoized `getDb()`), run `exec(SCHEMA)` + the `cwd` migration exactly once at startup (the middleware in `src/middleware.ts:8` already runs once — do the migration there or in a `migrate(db)` called once). Pages call `getDb()` and never `.close()`. This removes connection churn and repeated DDL entirely.
Effort: **M**

### P0-2. SessionReader opens its own DB connection nested inside the index render
`src/pages/index.astro:20-32` opens+closes a connection, then renders `<SessionReader>` (`index.astro:57`) which in `SessionReader.astro:17` opens a **second** connection and closes it (`:33`). So a single "open a session" page load pays two full `openDb()` schema-replays back to back. Same pattern would multiply if more components self-open.
**Fix:** Same singleton from P0-1; or pass the already-open `db`/loaded data down as a prop from `index.astro` so the reader doesn't open its own. Singleton is cleaner.
Effort: **S** (once P0-1 lands)

### P0-3. `searchMessagesExact` / `searchMessagesRegex` do full table scans of `messages.text_content`
`src/db/messages.ts:135-164` (`LIKE '%'||q||'%'`) and `:166-211` (`ccaudit_regexp` UDF over every row). There is no index that can serve a leading-wildcard LIKE or a regex, so SQLite scans every message row (potentially hundreds of thousands of rows for a heavy user) and runs a JS regex callback per row for the regex path. The `session_id IN (SELECT ...)` subquery is also re-evaluated. On a large DB these modes will take seconds and block the Node event loop (better-sqlite3 is synchronous).
**Fix:** (a) For exact mode, prefer routing through FTS5 with a phrase query (`"term"`) when the input is a single token/phrase, falling back to LIKE only for substrings FTS can't express. (b) For regex, first narrow with FTS on any literal substring extractable from the pattern, then apply the JS regex only to that candidate set. (c) At minimum cap scan cost: the `LIMIT` is applied after the scan, so it doesn't help — add an early-exit by iterating a prepared statement and stopping at `limit` matches instead of `LIMIT` on a full scan, or push the exclusion subquery into a join. Document that exact/regex are O(n) so users prefer Smart mode.
Effort: **M**

---

## P1 — Perf / quality

### P1-1. `getLibraryTree` is rebuilt on every page including ones that only need the sidebar
`src/db/library.ts:65-117`. It runs `listWorkdirs` (two full-table scans: `workdirs` + `workdir_tokens`, `src/db/workdirs.ts:82-92`), `computeRepoComponents` (union-find over all workdirs+tokens, `src/identity/components.ts:42`), then a full `SELECT ... FROM sessions ORDER BY last_activity DESC` (every visible session row, `library.ts:71-79`), and builds Maps/arrays for all of them. It is called on `index.astro:21`, `graph.astro:14`, `search.astro:20`, and `projects.astro`. On `/search` and `/graph` the tree is only used to render the Sidebar — yet it loads and groups every session in the DB. With thousands of sessions this is the dominant cost of those pages.
**Fix:** (a) Memoize `getLibraryTree` with a cache key = `MAX(indexed_at)` + exclusions hash; invalidate on reindex. Since the middleware reindexes once per process (`middleware.ts:9`), the tree is effectively static after startup — cache it process-wide. (b) For pages that only need the sidebar, build a lighter "sidebar tree" that selects only `id, cwd, ai_title, first_prompt, last_activity` (already done) but skips the per-session `ListItem` assembly when not needed. The memo (a) is the big win.
Effort: **M**

### P1-2. `index.astro` builds a full flat palette of **every** session on every load
`src/pages/index.astro:47-51`. `paletteItems` flatMaps every repo→workdir→session into an array of `{label, sub, href, kind}` objects and serializes them into the page for the ⌘K palette. For a user with thousands of sessions this is a multi-thousand-element array embedded in **every** page render (the palette is in the shell), inflating HTML payload and SSR string-building time even when the user never opens ⌘K.
**Fix:** Move palette population to a lazy client fetch: a small `/api/palette` endpoint (or a static JSON written at index time) loaded on first ⌘K open. Cap the inlined set to e.g. the 200 most-recent sessions + all repos/workdirs, and let search hit the API for the rest. Effort to inline-cap only: **S**; full lazy endpoint: **M**.
Effort: **S–M**

### P1-3. Search page issues an N+1 `getSession` per hit
`src/pages/search.astro:27` — `raw.map((h) => ({ ...h, session: getSession(db, h.sessionId) }))`. With `limit: 50` that's up to 50 separate `SELECT * FROM sessions WHERE id = ?` round-trips, each returning the full row (including `first_prompt`, raw fields) when only `projectLabel` + `lastActivity` are rendered (`:80-82`).
**Fix:** Single query: `SELECT id, project_label, last_activity FROM sessions WHERE id IN (...)` over the distinct hit session ids, build a `Map`, then attach. Reduces 50 queries to 1 and trims the row width.
Effort: **S**

### P1-4. FTS search joins back to `messages` just to map rowid→session, and exclusion is a correlated subquery
`src/db/messages.ts:99-118`. The FTS query is good (uses bm25 ranking + `snippet`), but `session_id IN (SELECT id FROM sessions WHERE ${excl.sql})` is re-checked per candidate row. For the common "no exclusions" case `excl.sql` is `"1"`, so the subquery degenerates to `IN (SELECT id FROM sessions)` — a needless scan/materialization of the entire sessions id set on every search.
**Fix:** Short-circuit: when `listExclusions` is empty, drop the `AND session_id IN (...)` clause entirely (the `sessionKeepCondition` returns `sql:"1"` — detect that and omit the whole subquery). Apply the same short-circuit in `searchMessagesExact`/`Regex`.
Effort: **S**

### P1-5. Graph payload ships **every** node + link to the client with no cap
`src/db/graph.ts:89-189` and `src/db/repo-graph.ts:34-113` emit one node per session plus one link per session, plus continuation links (one per consecutive session pair within a project). For N sessions that's ≥2N graph elements serialized via `JSON.stringify(graph)` into a `data-graph` attribute (`graph.astro:22,105`). At a few thousand sessions this is a multi-MB attribute string parsed client-side (`graph.astro:114`) and fed to a d3-force sim that then runs `forceManyBody` + `forceCollide` over thousands of nodes — the simulation tick (`:282-294`) updates every DOM line/circle each tick, which will jank badly above ~1–2k nodes.
**Fix:** (a) Default the graph to hubs-only (repos/projects/folders) and load session nodes for a repo/folder on click/expand via an API. (b) Cap or cluster sessions per project (e.g. collapse to a count badge above K). (c) Gzip is usually on for the SSR response, but the parse + sim cost remains — the expand-on-demand model is the real fix. (d) Use a `<canvas>` renderer instead of one SVG `<g>` per node for large graphs.
Effort: **L**

### P1-6. `SessionReader` parses `raw_json` JSON per visible tool message during SSR
`src/components/SessionReader.astro:56-66` `toolName()` calls `JSON.parse(rawJson)` for every `tool-use` block among up to `CAP=500` visible turns, and `renderMarkdown` is awaited per user/assistant block (`:71-78`). The `raw_json` column is the full message blob; parsing 500 of them synchronously per render adds up, and `getSessionMessagesTail` already loads `RAW_TAIL=2500` rows including the heavy `raw_json` and `text_content` for all of them even though only ~500 render.
**Fix:** (a) Don't select `raw_json` unless needed — the tool name could be extracted and stored at index time into a dedicated column (e.g. `tool_name`) so the reader never parses JSON. (b) Apply the `CAP` slice before markdown rendering already happens (good), but also avoid loading `raw_json` for the non-rendered tail rows — select only the columns the reader uses, or load the tail with `text_content` only and fetch `raw_json` lazily. (c) Cache rendered HTML per (sessionId, spineHash) since transcripts are immutable once indexed.
Effort: **M**

### P1-7. `listWorkdirs` loads the entire `workdir_tokens` table to assemble token sets
`src/db/workdirs.ts:82-92`. Two unbounded `SELECT *` scans (`workdirs`, `workdir_tokens`) on every `getLibraryTree`/graph build. Tokens are commit hashes — potentially many per workdir. This is fine at small scale but compounds P1-1 (it's inside the un-memoized tree build).
**Fix:** Primarily fixed by memoizing the tree (P1-1). If kept hot, restrict the token scan to workdirs that actually have ≥1 visible session by joining against distinct `cwd` from sessions, avoiding loading tokens for dead workdirs.
Effort: **S** (mostly subsumed by P1-1)

### P1-8. `dayBucket` / list grouping does O(n) array spread-copies
`src/db/library.ts:89` (`byWorkdir.set(r.cwd, [...(byWorkdir.get(r.cwd) ?? []), s])`) and `:182` and `topics.ts`-style spreads. Each insert copies the whole accumulated array → overall O(n²) grouping when one workdir/bucket holds many sessions. A workdir with 2k sessions does ~2M array copies.
**Fix:** `const arr = map.get(k) ?? []; if (!map.has(k)) map.set(k, arr); arr.push(s);` — push into the existing array instead of recreating it. Same pattern at `graph.ts:135-137` (that one already pushes correctly) and `repo-graph` token grouping (`workdirs.ts:90` has the same spread bug).
Effort: **S**

### P1-9. `listSessionsGrouped` re-sorts and re-filters the whole tree in JS for every selection
`src/db/library.ts:137-187`. For a `topic` selection it `flatMap`s every repo→workdir→session and filters by a Set (`:167`); for `repo`/`all` it flatMaps everything then `.sort()`s again (`:173`). The tree is already sorted by `last_activity DESC` in SQL (`:77`), so the re-sort is redundant for the "all/recent" case, and the topic case scans every session to find a handful.
**Fix:** For topic selection, query members directly: `SELECT ... FROM sessions WHERE id IN (topicIds) ...` instead of scanning the whole tree. Drop the redundant `.sort()` when the source is already ordered. 
Effort: **S**

---

## P2 — Features / nice-to-have

### P2-1. No `PRAGMA` tuning for read-heavy SSR
`src/db/init.ts:134-135` sets WAL + foreign_keys but not `synchronous=NORMAL`, `cache_size`, `mmap_size`, or `temp_store=MEMORY`. For a read-mostly browse/search workload these meaningfully cut I/O.
**Fix:** Add `synchronous=NORMAL`, `cache_size=-16000` (16MB), `mmap_size=268435456`, `temp_store=MEMORY` once at startup. Effort: **S**

### P2-2. No HTTP caching headers on SSR pages
Pages are fully recomputed each navigation. Since data only changes on reindex (once per process), `/graph`, `/projects`, and the sidebar could carry a short `Cache-Control`/ETag keyed on `MAX(indexed_at)`.
**Fix:** Set `Astro.response.headers` with an ETag = max indexed_at; 304 on match. Effort: **M**

### P2-3. `searchMessagesRegex` registers the UDF every call and compiles the regex per row
`src/db/messages.ts:179-186` registers `ccaudit_regexp` on every invocation and constructs `new RegExp(pat,...)` inside the UDF for **every row** rather than closing over one compiled regex.
**Fix:** Compile the regex once outside and reference it in the UDF (the outer `re` at `:172-174` already exists — use it instead of recompiling per row). Effort: **S**

### P2-4. Continuation links computed even though hidden by default
`src/db/graph.ts:170-187` always builds continuation links (O(sessions) extra link objects) and ships them, but the UI hides them behind a checkbox (`graph.astro:78`, default off).
**Fix:** Compute/ship continuation links lazily on toggle via an API, or gate behind a query param. Effort: **S**

---

## Already good
- `getSessionMessagesTail` (`messages.ts:76-89`) correctly avoids loading 17k rows by tailing with `ORDER BY ... DESC LIMIT` then re-ordering — and the reader caps rendered turns at 500 (`SessionReader.astro:41-43`). Solid large-session handling.
- FTS5 with `porter unicode61`, `bm25` ranking, and `snippet()` (`init.ts:44-49`, `messages.ts:99-118`) is the right primitive; triggers keep it in sync on insert/update/delete (`init.ts:51-60`).
- `insertMessages` batches inside a single transaction (`messages.ts:44-61`); indexer is incremental via mtime+size skip (`index-runner.ts:62-70`).
- Indexes on `sessions(last_activity)`, `sessions(project_dir,last_activity)`, `messages(session_id,line_no)` match the actual query order-bys (`init.ts:24-25,41`).
- `computeRepoComponents` union-find with path compression is near-linear (`components.ts:42-106`); the cost is re-running it per request (P1-1), not the algorithm.
