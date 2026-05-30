# ccaudit Polish Backlog

Synthesized & deduplicated from the six dimension audits (`architecture`, `performance`,
`ux`, `robustness`, `packaging`, `features`). Each item is tagged `[S/M/L]` (effort) and
carries the file refs + concrete steps. Within each tier, items are ordered by value/effort.
Provenance tags in parentheses point back to the source audit(s).

---

## P0 — correctness / bugs / blocking (do first)

### 1. `[M]` Topic-grouped GRAPH — add a "Topics" axis (explicit user ask)
Refs: `src/pages/graph.astro:30-36` (legend repos/workdirs/folders only), `src/db/graph.ts`,
`src/db/repo-graph.ts`, `src/db/topics.ts:22` (`listTopics`).
- Add a `view=topics` mode to `/graph` alongside the existing repo/folder views.
- New builder `buildTopicGraph(db)` in `src/db/graph.ts` (or a sibling `topic-graph.ts`):
  one hub node per topic from `listTopics`, one leaf/link per member session
  (`topic_members`), edge label = topic name. Cap/cluster sessions per topic (collapse to a
  count badge above K) so payload stays bounded (see P1 graph-cap item).
- Add a "Topics" entry to the graph legend/axis switcher and wire node-click to navigate to
  `/?topic=<id>` (the index already understands topic selection, `index.astro:28-29`).
  (ux P1.3, features — task #32)

### 2. `[M]` INCREMENTAL clustering — cluster only unclustered sessions; `force` = full re-cluster (explicit user ask)
Refs: `src/pages/api/cluster.ts:13-24` (only calls `replaceTopics`),
`src/db/topics.ts:34,41` (`getClusteredSessionIds`, `addToTopics` — written, tested-looking, **dead**),
`src/labeling/cluster-topics.ts:7` (`buildClusterPrompt`), `src/components/Sidebar.astro:27,104-116`.
- Add `mode: "incremental" | "full"` to the POST body. Default = incremental.
- Incremental: `const done = getClusteredSessionIds(db); const items = all.filter(s => !done.has(s.id))`;
  if `items.length === 0` return early; else `addToTopics(db, topics)` (do **not** `replaceTopics`).
- Feed existing topic names into the prompt ("assign to one of these existing topics or
  propose a new one") so new sessions snap onto established topics instead of inventing
  near-duplicates.
- `force`/"Re-cluster all" stays as an explicit secondary button → the `replaceTopics` path,
  and only wipe once the new set is validated non-empty (don't destroy topics on an empty/failed run).
- Before each run: `DELETE FROM topic_members WHERE session_id NOT IN (SELECT id FROM sessions)`
  to drop orphans, and join `topic_members` against `sessionKeepCondition` when counting so
  excluded sessions don't overstate topic counts.
  (features #1+#2, ux P0.2, robustness P1-4 — task #31)

### 3. `[M]` `serve` must run the built standalone server, not `npx astro dev` (published package is broken)
Refs: `src/cli/serve.ts:11-18,36` (`findProjectRoot` + `spawn("npx",["astro","dev",...])`),
`astro.config.mjs:8-10` (`output:"server"` → `dist-web/`), `grep dist-web src/` → 0 hits.
- `serveCommand` should spawn/launch `node <pkgRoot>/dist-web/server/entry.mjs` with `HOST`/`PORT`
  env (Astro node-standalone reads these). Resolve `pkgRoot` from `fileURLToPath(import.meta.url)`
  up to the package root — delete `findProjectRoot()` (astro.config.mjs won't ship; P1.4).
- Keep `astro dev` only behind a `--dev` flag for local hacking.
- Add `server.on("exit", code => {...process.exit(code??1)})` and `server.on("error", ...)` so a
  child crash/`npx` resolution failure surfaces instead of hanging on `await new Promise(()=>{})`.
  (packaging P0.1, arch P0, features #3, robustness P1-2)

### 4. `[S]` Add a `files` allowlist + build web in `prepare` so the tarball actually works
Refs: `package.json` (no `files`, no `.npmignore`), `package.json:18` (`"prepare":"tsup"`),
`.gitignore` (lists `dist-web/`). Verified `npm pack`: ships 58 `src/*.ts` + 490KB docs, **omits `dist-web/`**.
- Add `"files": ["dist/", "dist-web/", "public/", "README.md", "LICENSE"]`.
- Add `"build": "tsup && astro build"` and set `"prepare": "npm run build"` (and/or
  `"prepublishOnly": "npm run build && npm test"`) so `dist-web/` is always fresh at publish.
- Confirm `tsup clean:true` (`tsup.config.ts:8`) removes the stale stray `dist/client`+`dist/server`.
  (packaging P0.2/P0.3/P0.4, arch P0)

### 5. `[S]` Sanitize/escape the FTS `MATCH` query — ordinary input crashes CLI & MCP
Refs: `src/db/messages.ts:91-119,107` (raw `messages_fts MATCH @q`), unguarded callers
`src/cli/search.ts:18`, `src/mcp/tools.ts:40` (search.astro:22-30 catches; these don't).
- Add `escapeFtsQuery(q)`: split on whitespace, wrap each term in double-quotes doubling internal
  `"` (`term.replace(/"/g,'""')` → `"…"`), join by space. Call it inside `searchMessages` before MATCH.
- This fixes `foo"`, lone `(`, trailing `AND`/`OR`/`NOT`, leading `*`, `foo:` for CLI, MCP, and web.
  (robustness P0-1, arch P0)

### 6. `[S]` Clamp `--limit` parsing — `NaN`/negative/huge limits throw or silently empty
Refs: `src/cli/search.ts:18`, `src/cli/list.ts:11`, `src/mcp/tools.ts:35`.
- Helper: `const n = Math.trunc(Number(opts.limit)); return Number.isFinite(n) && n>0 ? Math.min(n,1000) : DEFAULT;`
- Apply in all three CLI commands + the MCP tool.
  (robustness P0-2)

### 7. `[M]` Harden `claude -p` failure modes (ENOENT / non-JSON / timeout) behind one wrapper
Refs: `src/labeling/label-segments.ts:28,31,33`, `src/labeling/cluster-topics.ts:36,39,41`,
`api/label.ts:54`, `api/cluster.ts:29`.
- Shared `runClaude()`: catch `err.code==="ENOENT"` → throw `"claude CLI not found on PATH — install
  Claude Code to enable AI naming"`; catch non-zero `err.status` → include trimmed stderr.
- Wrap the outer `JSON.parse(raw)` in try/catch → `"claude -p did not return JSON (got: …)"` (first-run
  banners/login prompts emit non-JSON). Inner `parseLabels`/`parseClusters` already fail soft to `[]`.
- Move shell-out from `execFileSync` to async `execFile`/`await` so the single-threaded SSR event loop
  isn't blocked for up to 10 min (this freezes **every** tab, not just the requester); return 504 on timeout.
- Surface these strings in the button state instead of a raw 500.
  (robustness P0-3/P0-4/P0-5, features #4, ux P0.1, packaging P1.8)

### 8. `[M]` Cluster is a multi-minute fully-blocking POST with no progress / wipes topics on failure
Refs: `src/pages/api/cluster.ts:12-32`, `src/components/Sidebar.astro:104-116`.
- Make it a background job: POST returns `{jobId}` immediately, spawns the cluster, and a
  `GET /api/cluster?job=<id>` is polled every 2s by the button ("Clustering 142 sessions… ~2 min").
  Add an in-process in-flight guard so a second cluster/label call returns 409 "already running".
- Minimum (S) if deferring the full job model: inline note "~3 min & ~$0.08, keep this tab open" +
  a real spinner the instant it's clicked, and only `replaceTopics` after a non-empty result.
  (ux P0.1, robustness P0-5/P1-4, features #4) — pairs with item 2 & 7.

### 9. `[M]` Process-wide DB singleton — stop re-running full schema DDL on every render
Refs: `src/db/init.ts:131-142` (`openDb` does `mkdirSync` + `exec(SCHEMA)` + `table_info` probe each call),
opened ≥2-3×/render (`index.astro:20`, `SessionReader.astro:17`, every api route, all CLI cmds).
- Add lazy memoized `getDb()` in `init.ts`; run `exec(SCHEMA)` + the `cwd` `ALTER TABLE` migration
  exactly once at startup (or via `migrate(db)` called from middleware). Pages call `getDb()`, never `.close()`.
- Open the web handle `readonly` and apply read-path pragmas (`synchronous=NORMAL`, `cache_size=-16000`,
  `mmap_size=268435456`, `temp_store=MEMORY`) once at open.
- **Blocks item 10** (regex UDF) and removes the per-component `openDb` copy-paste (~12 sites).
  (perf P0-1/P0-2, arch P1, robustness P1-5)

### 10. `[S]` Register the `ccaudit_regexp` UDF once at open, not per query
Refs: `src/db/messages.ts:179-186` (`db.function("ccaudit_regexp",...)` re-registered every call).
- better-sqlite3 throws on redefining a function on the *same* connection — masked today only because
  each request opens a fresh handle; the moment item 9 lands, the 2nd regex search throws.
- Register the UDF once in `openDb`/`getDb` (init.ts), closing over a single compiled `RegExp` instead
  of `new RegExp(...)` per row.
  (arch P0, perf P2-3, robustness P0-8) — do together with item 9.

### 11. `[S]` Resume command: POSIX-quote the `cwd` and stop emitting the lossy decoded path
Refs: `src/pages/api/sessions/[id]/resume.ts:17-18`, `src/components/SessionReader.astro:84`,
`src/paths.ts:20-22` (`decodeProjectDir` replaces every `-`→`/`).
- Single-quote escape: `const q = "'" + cwd.replace(/'/g, "'\\''") + "'"; cmd = \`cd ${q}\nclaude --resume ${id}\``.
- Only emit the `cd` when `session.cwd` exists (and `existsSync`); otherwise emit bare
  `claude --resume <id>` + note "original cwd unknown". Never use `decodeProjectDir` output as a real path.
  (robustness P0-6/P0-7, arch P1)

### 12. `[S]` Normalize decoded `project_dir` (`--`→`//` quirk) and coalesce zero-row aggregates
Refs: `src/paths.ts:21,26`, `src/db/stats.ts`, `src/components/Dashboard.astro:34-72`.
- Collapse `//`→`/` in `decodeProjectDir` before storing so exclusions/equality logic don't mismatch;
  add a test asserting no stored `project_dir` contains `//`.
- Guard `MIN/MAX/AVG` over zero rows with `COALESCE(...,0)` so an empty index doesn't render `NaN`/`null`
  (feeds the empty-state panel in P1).
  (robustness P0-9/P0-10)

---

## P1 — UX & performance (high value)

### 1. `[M]` Memoize `getLibraryTree` process-wide — the single biggest perf liability
Refs: `src/db/library.ts:65-117`, callers `index.astro:21`, `graph.astro:14`, `search.astro:20`,
`projects.astro:14`; `listWorkdirs` two full scans (`workdirs.ts:82-92`), `computeRepoComponents`.
- Memoize with key = `MAX(indexed_at)` + exclusions hash; invalidate on reindex. Since middleware
  reindexes once per process, the tree is effectively static after startup — cache it process-wide.
- Eliminates the full union-find + full sessions scan currently paid on `/search`, `/graph`, `/projects`
  (which only need the sidebar). (perf P1-1/P1-7, arch P0, ux P2.5)

### 2. `[S]` First-run / empty-index onboarding instead of an all-zeros dashboard
Refs: `src/components/Dashboard.astro:34-72`, `src/pages/index.astro:57`, `src/cli/serve.ts:24-33`.
- When `stats.totalSessions === 0`, render a dedicated first-run panel (where ccaudit looked, how to
  point it elsewhere via `CCAUDIT_PROJECTS_DIR`, link to docs) instead of zeroed widgets/heatmap.
- In `serve`, if projects dir missing or 0 indexed, print a clear message + the
  `~/.ccaudit/logs/index-errors.log` path when `errors>0`; pass `onProgress` for incremental feedback.
  (ux P0.3, features #13, robustness P1-8, packaging P1.6)

### 3. `[S]` Wrap DB access in shell pages with a recoverable error panel
Refs: `src/pages/index.astro:20-32`, `Dashboard.astro:8-12`, `graph.astro:12` (no try/catch; only
`search.astro:28-30` guards). Missing/corrupt `~/.ccaudit/index.db` throws a raw Astro 500.
- Wrap `getDb()`/queries in the shell pages and render a friendly "run `ccaudit reindex`" panel.
  Also render an explicit "session not found / source file removed" state when `getSession` returns null
  (`SessionReader.astro:23-27`). (ux P1.10, robustness P1-7)

### 4. `[S]` Search hits: dedupe `getSession` N+1, keep selection context, deep-link to the match line
Refs: `src/pages/search.astro:27` (per-hit `getSession`, up to 50 round-trips), `:77` (bare `/?session=`),
`:81` (`line {lineNo}`), `SessionReader.astro:123` (unused `id="m<lineNo>"` anchors).
- Replace the per-hit `getSession` with one `SELECT id, project_label, last_activity FROM sessions WHERE
  id IN (...)` → Map → attach.
- Append `#m<lineNo>` to the hit href so the reader scrolls to the match; carry repo/topic context the way
  `index.astro:36-44` already does. (perf P1-3, ux P1.8)

### 5. `[S]` Loading states + clipboard feedback — stop blanking the page on every action
Refs: `Sidebar.astro:113,133`, `SessionReader.astro:236,248-250`, `projects.astro:80`.
- Add a subtle top progress bar / disabled overlay during cluster/hide/name/exclude fetches (all currently
  hard `location.reload()`).
- Resume "Copy": flip to "Copied ✓" for 1.5s on success; on failure select the `<pre>` text as fallback.
  (ux P1.2, P0.4)

### 6. `[S]` Short-circuit the FTS/exact/regex exclusion subquery when there are no exclusions
Refs: `src/db/messages.ts:99-118` (FTS), `:135-164` (exact), `:166-211` (regex);
`sessionKeepCondition` returns `sql:"1"` when empty → `IN (SELECT id FROM sessions)` scans all ids per row.
- Detect the empty-exclusions case and omit the whole `AND session_id IN (...)` clause across all three modes.
  Also fix the O(n²) array-spread grouping (`library.ts:89,182`, `workdirs.ts:90`) to push into the existing array.
  (perf P1-4/P1-8)

### 7. `[M]` Cap / lazy-load the graph payload (and the ⌘K palette) instead of shipping everything
Refs: `src/db/graph.ts:89-189`, `repo-graph.ts:34-113`, `graph.astro:22,105,282-294`;
`index.astro:47-51` (`paletteItems` flatMaps every session into every page).
- Graph: default to hubs-only (repos/folders/topics), load a hub's session nodes on click/expand via an API;
  cap/cluster sessions per project above K. (Pairs with P0 item 1's topic view.) Janks badly >~1-2k nodes today.
- Palette: cap the inlined set to ~200 most-recent + all repos/workdirs; move full population to a lazy
  `/api/palette` fetched on first ⌘K open. (perf P1-5/P1-2)

### 8. `[S]` Discoverability + ⌘K polish: always-visible hide buttons, scroll-into-view, empty states
Refs: `Sidebar.astro:87-90` (`.hide-btn{display:none}` until hover — touch-inaccessible),
`CommandPalette.astro:60,71-78` (no `scrollIntoView`, no "no results" row).
- Keep hide buttons at low opacity (or a `⋯` overflow menu) so they're touch-reachable; tooltip the count→✕ swap.
- `li.scrollIntoView({block:'nearest'})` on palette selection change; render a muted "No jumps — press ↵ to
  full-text search" empty row. (ux P1.4/P1.5)

---

## P2 — features & packaging

### 1. `[M]` Capture token/cost data from JSONL → AI spend visibility (the killer differentiator)
Refs: `src/indexer/extract.ts`, `aggregate.ts:observe` (drops `message.usage` + `message.model`),
`db/init.ts` (add columns), new `src/lib/pricing.ts`, `db/analytics.ts`.
- Sum per-session `input/output/cache_read/cache_creation` tokens + collect `models`; add columns to `sessions`.
- Add a model→rate price table; compute cost at render; surface as a Dashboard cost heatmap + a `list`/`stats`
  column + per-topic/per-repo spend. Unblocks per-model/per-tool drill-down. (features #5/#6/#14, ux P1.3/P2.1)

### 2. `[S]` Add `ccaudit stats` and `ccaudit topics` CLI subcommands
Refs: `cli/index.ts`, existing `getIndexStats`, `getActivityByDay`, `getToolUsage`, `listTopics`.
- ~30 lines each reusing existing db fns so the CLI answers "what's in here?" without a server. (features #7)

### 3. `[M]` Topic management API: rename / merge / delete
Refs: new `src/pages/api/topics.ts`, helpers next to `src/db/topics.ts:41`.
- `PATCH {id,name}`, `POST {mergeIds,into}` (re-point `topic_members.topic_id`, delete emptied topics),
  `DELETE {id}`. Lets users fix "Auth"/"Authentication"/"Login" without a full re-cluster. (features #8, ux P2.2)

### 4. `[M]` Live file-watcher → auto-reindex + SSE refresh for in-progress sessions
Refs: `serve.ts:27` (indexes once at boot), `index-runner.ts:62` (already incremental via mtime+size).
- `fs.watch(CLAUDE_PROJECTS_DIR,{recursive:true})` debounced 2s → `indexAll` → SSE-notify the open tab.
- Move middleware auto-reindex off the first-request hot path (set `hasIndexed` in `finally`, not before
  the await, so a failure retries). (features #10, arch P0 middleware, robustness)

### 5. `[S]` Packaging metadata + LICENSE + cross-platform `open`
Refs: `package.json:3,54`, `src/cli/serve.ts:49` (`exec('open ...')` macOS-only), `README.md:60,66`.
- Add `repository`/`homepage`/`bugs`/`author`/`keywords`; ship a `LICENSE` file (MIT); bump to `0.1.0`.
- Branch `open` on `process.platform` (`darwin`→`open`, `win32`→`start ""`, else→`xdg-open`).
- Fix README: change the `docs/superpowers/specs/` pointer to a GitHub link (won't ship). (packaging P1.1/P1.2/P1.3/P1.5/P1.7)

### 6. `[S]` `doctor` probes `claude` CLI + `better-sqlite3` load; `prepublishOnly` test gate
Refs: `src/cli/doctor.ts`, `package.json`.
- `doctor` runs `execFile("claude",["--version"],{timeout:5000})` (present/absent) and confirms
  `better-sqlite3` loads. Add `prepublishOnly: npm run build && npm test && typecheck`. (robustness P2-1, packaging P0.5/P2.1)

### 7. `[L]` "Ask your history" RAG chat + session/topic export
Refs: `searchMessages` (retrieval already returns snippets+lineNo), `src/lib/render.ts`, `markdown.ts`.
- Chat: thin prompt-assembly + streaming `claude -p` endpoint over FTS-retrieved spans, cite back to `s/[id]?line=`.
- Export: `ccaudit export <id> --format md|json|html` + "Copy as Markdown" in the reader; exporting a whole
  topic as one doc is a novel artifact. (features #11/#12)

### 8. `[M]` Reader "Load earlier" + mobile fixes for the 500-turn cap & seg-nav overlap
Refs: `SessionReader.astro:41-43,110-111,157-163,183` (`.seg-nav`/`.mini` absolute over content),
`AppShell.astro:74-76` (caret-in-`<a>` closes drawer, can't expand a repo on mobile).
- Add a "Load earlier" button at the reader top to fetch the prior window (the early, context-rich turns are
  currently silently dropped — defeats the audit use-case). Hide `.seg-nav`/`.mini` under 900px or make them a
  bottom sheet; stop the caret from triggering navigation/closing the drawer. (ux P1.7/P1.9)

### 9. `[S]` Code-health cleanups (consolidate duplicated logic, kill dead code)
Refs: `library.ts:54-58`/`SessionReader.astro:80-82` (`titleOf` dup → one `sessionTitle()`),
`messages.ts:135-211` (exact/regex near-dupes → one predicate helper),
`SessionReader.astro:21`/`api/label.ts:28` (`RAW_TAIL=2500` magic constant → `loadMessagesForReader()`),
`cli/search.ts:27` (no-op `stripMarks(x)===x?x:x`), `analytics.astro:1-4` (dead stub — implement or delete),
`db/exclusions.ts` (dual-polarity `sessionKeepCondition`/`exclusionCondition` footgun).
- Add focused tests for the three real gaps: FTS metachar handling, regex-UDF re-registration on a reused
  connection, middleware auto-reindex failure path. (arch P1/P2, perf, features #9)

### 10. `[M]` Robustness hardening: oversized JSONL lines, schema versioning, git buffer bounds
Refs: `indexer/parse.ts:19-31` + `aggregate.ts:63` (cap stored `rawJson` ~256KB; skip lines over a size
threshold before `JSON.parse` to avoid OOM on pasted-image blobs), `init.ts:137-140` (use `PRAGMA user_version`
+ ordered migration list instead of ad-hoc `ALTER TABLE` probe), `resolve.ts:44` (use
`git rev-list --max-count` from each end so huge histories don't hit `maxBuffer` ENOBUFS).
- Fall back to `fileMtime` for `lastActivity` when all timestamps are null so sidebar ordering is stable.
  (robustness P1-1/P1-6, P2-2/P2-4)
