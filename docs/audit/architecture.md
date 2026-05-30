# ccaudit — Architecture & Code Quality Audit

Scope: module boundaries, DRY, dead code, file sizes/responsibilities, type safety, the
per-component `openDb` pattern, test-coverage gaps, naming/consistency. File:line refs are
against the tree audited on this branch.

---

## P0 — Bugs / correctness / blocking

- **`serve` command depends on the source tree + `astro dev`, so the published npm package can't run.**
  `src/cli/serve.ts:11-18,36` — `findProjectRoot()` walks up looking for `astro.config.mjs`, then
  `spawn("npx", ["astro", "dev", ...], { cwd: root })`. The package only ships `dist/` (`bin` →
  `dist/index.js`); `astro.config.mjs`, `src/`, and a dev `astro` aren't present in a global
  `npm i -g ccaudit` install, and even if they were, shipping a *dev server* is wrong for a published
  CLI. Fix: build the SSR app to `dist-web/` (already the configured output), ship it in `files`, and
  have `serve` import/launch the node-standalone server entry (`dist-web/server/entry.mjs`) in-process
  instead of shelling to `astro dev`. Add a `files` allowlist to package.json (currently absent — the
  whole repo, incl. `src/`, would publish). **Effort: M**

- **`package.json` has no `files` field → publishes `src/`, `tests/`, `docs/`, `.astro/`, dev configs.**
  `package.json` — without `files`, `npm publish` ships everything not in `.npmignore` (there is none).
  Bloats the tarball and leaks the dev tree. Add `"files": ["dist", "dist-web", "README.md"]` and make
  `prepare`/`prepublishOnly` build both CLI and web. **Effort: S**

- **Auto-reindex on first request blocks the first page load and is unbounded.**
  `src/middleware.ts:8-21` — the first HTTP request triggers a full synchronous `await indexAll(...)`
  (walk every JSONL, parse, FTS-insert thousands of rows) before `next()`. On a large `~/.claude`
  this is a multi-second-to-minute hang with no feedback, and a parse/IO throw rejects the very first
  request (and `hasIndexed=true` is set *before* the work, so a failure is never retried). Fix: gate
  reindex behind the CLI (`serve` already indexes at startup, `serve.ts:25-33`) and have the middleware
  only index if the DB is empty, in the background, or not at all. At minimum set `hasIndexed=true`
  inside the `finally`, not before the work. **Effort: M**

- **`searchMessagesRegex` registers a SQL UDF on the connection on every call, never removing it.**
  `src/db/messages.ts:179-186` — `db.function("ccaudit_regexp", ...)` is (re)registered each query.
  better-sqlite3 throws on re-defining a function on the *same* connection; today it's masked only
  because each request opens a fresh connection (see per-component `openDb` below). The moment a
  connection is reused (the right fix for perf), this throws on the 2nd regex search. Register UDFs
  once at `openDb` time in `init.ts`, not inside the query function. **Effort: S**

- **FTS `MATCH` query is passed the raw user string; common inputs throw a 500-class error.**
  `src/db/messages.ts:107` (`messages_fts MATCH @q`) ← `src/pages/search.astro:26`. It's parameterized
  (no injection), but FTS5 query syntax means inputs like `foo"`, `a AND`, `nimble*"`, or a lone `(`
  raise `fts5: syntax error`. search.astro catches it (`:28`) and shows the raw engine message, which
  is a poor UX for ordinary searches (e.g. a quote in a query). Sanitize/quote the user query for FTS
  (wrap bare terms in double-quotes, escape embedded quotes) before MATCH, or fall back to `exact`
  mode on FTS syntax error. **Effort: S**

- **`getLibraryTree` is the de-facto data layer for *everything* and is recomputed per concern.**
  `src/db/library.ts:65-117` — repo identity (union-find via `computeRepoComponents`), exclusions,
  per-session titles, and the full session list are rebuilt on every page. `index.astro:21,31` reuses
  one tree (good), but `cluster.ts:14`, `search.astro:20`, and `graph.astro` each rebuild it from
  scratch, and `listSessionsGrouped` will rebuild it again if not handed `precomputedTree`
  (`library.ts:143`). For large histories this is the dominant cost and it's silently O(repos·workdirs·
  sessions) on each request. Not wrong, but it's the single biggest perf liability — see P1 caching. **Effort: M**

---

## P1 — UX / perf / quality

- **Per-request/per-component `openDb` opens a brand-new WAL connection (and re-runs schema) each time.**
  `openDb` (`src/db/init.ts:131-141`) runs `mkdirSync`, opens the file, sets pragmas, `exec(SCHEMA)`
  (every `CREATE … IF NOT EXISTS` + the `table_info` migration check) on *every* call. A single page
  render opens it ≥2-3×: `index.astro:20`, then `SessionReader.astro:17` (or `Dashboard.astro:8`),
  and the API routes each open their own. That's redundant schema execution and connection churn on
  the hot path. Fix: a process-wide singleton (lazy `getDb()` memoized in `init.ts`) opened read-mostly;
  the indexer can keep its own writable handle. Components import the shared handle instead of
  `openDb(INDEX_DB_PATH)`. This is the cleanest single refactor and unblocks the regex-UDF fix. **Effort: M**

- **`INDEX_DB_PATH` + `openDb(INDEX_DB_PATH)` is copy-pasted in ~12 call sites.**
  Every consumer writes `const db = openDb(INDEX_DB_PATH)` / `db.close()` (middleware, all CLI cmds,
  all api routes, 4 pages, 2 components). Once a singleton exists, expose `getDb()` so the path is
  bound in exactly one place and `db.close()` disappears from request code (a leaked handle on an
  early-return path is currently possible — e.g. label.ts has 4 separate `db.close()` calls). **Effort: S**

- **`graph.astro` is 387 lines — a page doing data-shaping, an inline d3-force sim, and styling.**
  `src/pages/graph.astro` is by far the largest file and mixes three responsibilities. Extract the
  client d3 simulation into a `src/lib/graph-sim.ts` (or a small island component) and the node/edge
  shaping into `src/db/graph.ts` (which already exists at 190 lines — some of this belongs there).
  Same smell, smaller, in `SessionReader.astro` (252 lines: data load + classify + markdown render +
  two inline `<script>` blocks). **Effort: M**

- **`titleOf` / title-derivation logic is duplicated three ways.**
  `library.ts:54-58` (`titleOf`), `SessionReader.astro:80-82` (inline `aiTitle ?? cleanPromptText(...)`),
  and the palette/list builders all re-derive a display title with slightly different fallbacks
  (`id.slice(0,8)` vs `shortSessionId` vs `Session ${shortSessionId}`). Consolidate into one
  `sessionTitle(session)` in `src/lib/render.ts` and call it everywhere so titles are consistent across
  list, reader, palette, and search. **Effort: S**

- **`toolName()` (SessionReader) and the tool-detection in `classifyMessage()` re-parse the same `raw_json`.**
  `SessionReader.astro:56-66` `JSON.parse(rawJson)` to get the tool name, and `message-kind.ts:51-59`
  already `JSON.parse(m.rawJson)` to classify it as `tool-use`. For a 500-turn render that's two JSON
  parses per tool message. Have `classifyMessage` (or a sibling) return the parsed shape / tool name
  once. Also `text_content` is stored *and* `raw_json` is stored in full for every row
  (`init.ts:37-38`) — the largest table cost; worth noting the DB roughly doubles message storage. **Effort: M**

- **`searchMessagesExact` and `searchMessagesRegex` are near-duplicates.**
  `src/db/messages.ts:135-211` — identical shape (build excl, same SELECT skeleton, same exclusion
  subquery, same row→SearchHit map, shared `contextSnippet`). Factor the common
  "scan messages by predicate → SearchHit[]" into one helper parameterized by the WHERE predicate.
  Cuts ~50 lines and keeps the exclusion-subquery logic in one place. **Effort: S**

- **Two magic constants (`RAW_TAIL = 2500`) must be kept in sync by hand across files.**
  `SessionReader.astro:21` and `api/label.ts:28` both hardcode `2500` *and* the
  `messageCount > RAW_TAIL ? tail : full` branch, because the label API must segment the *same* message
  set the reader rendered or the spine hash won't match. If one drifts, cached labels silently stop
  matching. Extract the load-policy (`loadMessagesForReader(db, session)`) into one function used by
  both. Same for `CAP = 500` if it ever affects segmentation. **Effort: S**

- **`decodeProjectDir` is documented-as-lossy and still used as if it were a path.**
  `src/paths.ts:20-22` replaces every `-` with `/`, which mangles any real dir containing a dash. The
  identity layer correctly prefers the recorded `cwd`; make sure `project_dir`-derived labels never
  reach a place that treats them as a real filesystem path (e.g. the resume `cd` command in
  `SessionReader.astro:84` falls back to `projectDir` when `cwd` is null — that path can be wrong). Prefer
  `cwd`-only for resume and show "(unknown dir)" otherwise. **Effort: S**

- **`projects.astro` (analytics) and `analytics.astro` (4 lines) — the latter looks like a dead stub.**
  `src/pages/analytics.astro` is 4 lines; confirm it's a redirect/placeholder and either implement or
  delete it so the route map is honest. **Effort: S**

- **`searchMessages` FTS path and the two fallback paths return `SearchHit` but only FTS sets a real `rank`.**
  `messages.ts:118` vs `:162,210` (`rank: 0`). Downstream UI ignores rank, so this is latent, but the
  type implies a meaningful ordering that two of three modes don't provide. Document or drop `rank`
  from `SearchHit` for the non-FTS modes. **Effort: S**

---

## P2 — Features / nice-to-have

- **No connection/`better-sqlite3` read-only or `mmap`/`cache_size` pragmas for the read path.**
  `init.ts:134-135` sets only `journal_mode=WAL` + `foreign_keys=ON`. For a read-heavy browse UI,
  `PRAGMA mmap_size`, a larger `cache_size`, and opening the web handle `readonly: true` would cut
  per-page latency and prevent accidental writes from a render path. **Effort: S**

- **Test coverage is genuinely strong — note the gaps, not the absence.**
  24 test files cover db, indexer, identity (4 files), segment, labeling, cluster, exclusions
  (incl. integration), mcp, cli, markdown, render, library, repo-graph, message-kind. Real gaps:
  (1) **search FTS query handling** — no test feeds a query with FTS metacharacters (the P0/P1 above);
  (2) **`searchMessagesRegex` UDF re-registration** on a reused connection — untested precisely because
  every test/route opens fresh connections; (3) **middleware auto-reindex failure path**
  (`hasIndexed` set before the await). Add focused tests for these three. **Effort: M**

- **`openerOf`/`cleanPromptText`/`titleOf` all live in different layers but do overlapping cleanup.**
  `segment.ts:57`, `clean-prompt.ts`, `library.ts:54` each `replace(/\s+/g," ").trim()` plus prompt
  cleaning. A single `lib/text.ts` of normalizers would remove the scattered regex repetition. **Effort: S**

- **Naming: `sessionKeepCondition` vs `exclusionCondition` return opposite-polarity SQL.**
  `db/exclusions.ts` — one returns "rows to KEEP", the other (used by `listProjects`) an exclusion
  expr. Both are used; the dual polarity is a footgun (`sessions.ts:94` keep vs `:122` exclusion).
  Standardize on one (keep-condition) and derive the other, or rename to make polarity obvious. **Effort: S**

- **`AppShell.astro` re-renders the full `Sidebar` (incl. rebuilt tree) on the search page too.**
  `search.astro:20,41` builds the whole library tree just to render the sidebar on a search page.
  Once a tree cache (P0/P1) exists this is free; until then it's a second full tree build per search. **Effort: S**

### Already good (don't change)

- `resolveIdentity` (`identity/resolve.ts`) is clean, pure, and dependency-injected (`GitRunner`,
  `ManifestReader`) — exemplary testability.
- Exclusions use `substr/length` instead of `LIKE` to avoid `_`/`%` wildcard bugs and sibling-prefix
  false matches (`exclusions.ts` doc + impl) — correct and well-reasoned.
- `segmentSession` is genuinely deterministic, pure, and documents the compaction/timestamp
  non-monotonicity it defends against (`segment.ts:18-27`).
- Cached labels pinned to a `spineHash` (`labels.ts:7-10`) is the right invalidation strategy.
- All SQL is parameterized; the row→domain mappers (`rowToSession`, `rowToMessage`) keep snake_case
  isolated to the DB layer.
