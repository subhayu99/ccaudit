# ccaudit — Feature/Product Audit

Focus: product opportunities that make this a standout published tool. Effort tags: S (<½ day), M (1–2 days), L (multi-day).

---

## P0 — Bugs / correctness / blocking

### 1. Incremental clustering exists in DB layer but is **not wired up** — every cluster run wipes all topics
`src/db/topics.ts:34,41` (`getClusteredSessionIds`, `addToTopics`) are written, tested-looking, and **dead** — `src/pages/api/cluster.ts:24` only calls `replaceTopics` (full DELETE + re-cluster). So every "Cluster" click re-pays the ~$0.08 Haiku call over the *entire* corpus and destroys any prior topic edits/merges. This also doesn't scale: `buildClusterPrompt` (`cluster-topics.ts:7`) jams every title into one prompt — at a few thousand sessions it blows the model context and silently returns `[]` (`parseClusters:21` swallows the parse error).
**Fix:** add `mode: "incremental" | "full"` to the POST body. For incremental: `const done = getClusteredSessionIds(db); const items = all.filter(s => !done.has(s.id))`, then `addToTopics(db, topics)`. Feed *existing topic names* into the prompt ("assign to one of these existing topics or propose a new one") so new sessions snap onto established topics instead of inventing parallel near-duplicates. (effort: **M**)

### 2. Clustered-session set is computed on raw IDs but cluster reads from the visible library tree — drift on exclude/unhide
`cluster.ts:13-17` builds items from `getLibraryTree` (post-exclusion), but topics persist by `session_id` with no FK/cleanup. When a session is later excluded or a repo merged, `topic_members` keeps orphan rows; `listTopics` (`topics.ts:22`) still counts them, so topic counts overstate. **Fix:** join `topic_members` against the same `sessionKeepCondition` used in `stats.ts:13` when counting/listing, and `DELETE FROM topic_members WHERE session_id NOT IN (SELECT id FROM sessions)` at the start of each cluster run. (effort: **S**)

### 3. `serve` ships the **Astro dev server** to end users (`npx astro dev`)
`src/cli/serve.ts:36` spawns `npx astro dev`. For a "publish-quality npm package," shipping the dev server means: HMR/websocket overhead, dependence on devDeps at runtime, slow cold start, and `npx astro` resolution from the *user's* cwd. The repo already builds `dist-web/` (node standalone per the brief). **Fix:** spawn `node dist-web/server/entry.mjs` with `HOST/PORT` env; fall back to dev only under a `--dev` flag. Verifies the production output actually works, which is what users run. (effort: **M**)

### 4. Cluster/label failures surface as raw 500s with the Haiku error text; long calls have no UX feedback
`cluster.ts:31` / `label.ts:56` return `{error}` 500s. The Haiku call is synchronous `execFileSync` (`cluster-topics.ts:36`) blocking the Node event loop for up to 10 min (`timeout: 600_000`) — during which the **entire SSR server is frozen** (single-threaded), so the whole UI hangs for every other tab, not just the requester. **Fix:** move `claude -p` to `execFile` (async) or a worker; return a job id and poll. At minimum, document the freeze and lower the default corpus size. (effort: **M**)

---

## P1 — UX / perf / quality

### 5. Token/cost data is extracted from JSONL — capture it. (foundation for everything below)
`src/indexer/extract.ts` and `aggregate.ts` read `message.content` but **drop `message.usage` and `message.model` entirely**. Confirmed present on every assistant line: `{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` + `model` (e.g. `claude-opus-4-7`). This is pure signal already on disk. **Fix:** in `aggregate.ts:observe`, sum per-session `inputTokens/outputTokens/cacheReadTokens/cacheCreationTokens` and collect `models` (set); add columns to `sessions` in `db/init.ts`. This unblocks items 6–8 with zero extra API cost. (effort: **M**)

### 6. AI spend visibility — the killer differentiator (depends on #5)
No tool today shows a developer "you spent $X on Claude Code this month, broken down by repo/topic/model." With #5 captured, compute cost via a static price table (`opus`/`sonnet`/`haiku` per-Mtok in/out + cache-read discount) at render time. Surface in `Dashboard.astro` (cost heatmap alongside the existing message heatmap) and as a column in `list.ts:17`. This alone is a reason to install the tool. **Fix:** add `src/lib/pricing.ts` (model→rate map, easily updated), `db/analytics.ts:getCostByDay/getCostByRepo`. (effort: **M**)

### 7. CLI is missing `ccaudit stats` / `ccaudit topics` — the data exists, no terminal surface
`getIndexStats`, `getActivityByDay`, `getToolUsage`, `listTopics` are all implemented but only reachable via the browser. A published CLI should answer "what's in here?" without launching a server. **Fix:** add `stats` (totals + top tools + spend once #5 lands) and `topics` (list with counts) subcommands in `cli/index.ts`; ~30 lines each reusing existing db fns. (effort: **S**)

### 8. Topic management: rename / merge / delete (no endpoint exists)
Only `/api/cluster` mutates topics. Clustering is non-deterministic, so users *will* get "Auth" + "Authentication" + "Login Flow" as three topics and have no way to merge them — forcing a full re-cluster (item 1) that may re-split them. **Fix:** add `src/pages/api/topics.ts` with `PATCH {id, name}` (rename), `POST {mergeIds:[...], into}` (re-point `topic_members.topic_id`, delete emptied topics), `DELETE {id}`. DB helpers are ~5 lines each next to `topics.ts:41`. Pairs naturally with incremental clustering. (effort: **M**)

### 9. `search` CLI dead code + no project/mode filter
`cli/search.ts:27` has a no-op ternary `stripMarks(x)===x ? x : x` (always `x`) — leftover. And the CLI only does FTS, while `db/messages.ts` already exposes `searchMessagesExact`/`searchMessagesRegex` (used by MCP). **Fix:** delete the dead ternary; add `--mode <fts|exact|regex>` and `--project` flags mirroring the MCP tool (`mcp/tools.ts:29`). (effort: **S**)

### 10. No live file-watcher — index is stale the moment you open the UI mid-session
`serve.ts:27` indexes once at boot; an active Claude Code session started after launch never appears without manual `reindex`. **Fix:** after the server starts, `fs.watch(CLAUDE_PROJECTS_DIR, {recursive:true})` debounced 2s → call `indexAll` (already incremental via mtime+size at `index-runner.ts:62`) and SSE-notify the open tab to refresh the session list. High "wow" factor for a live-audit tool. (effort: **M**)

---

## P2 — Features / nice-to-have

### 11. "Ask your history" chat (RAG over sessions)
The highest-ceiling feature: a chat box that answers "how did I fix the Vite dep-scan crash?" by FTS-retrieving relevant message spans (`searchMessages` already returns snippets+lineNo) and feeding them to `claude -p`. The retrieval half is **already built**; only a thin prompt-assembly + streaming endpoint is new. Cite back to `s/[id]?line=`. Distinctive and on-brand for an "audit" tool. (effort: **L**)

### 12. Export — Markdown / JSON / shareable HTML of a session or topic
No way to get data out. `src/lib/render.ts` + `markdown.ts` already render messages. **Fix:** `ccaudit export <sessionId> --format md|json|html` and a "Copy as Markdown" button in `SessionReader.astro`. Exporting a whole *topic* (all sessions on "Repo Identity") as one doc is a genuinely novel artifact. Cheap given existing renderers. (effort: **M**)

### 13. First-run onboarding / `ccaudit init`
First run with an empty `~/.ccaudit/index.db` drops the user into a bare Dashboard. `doctor.ts` exists but isn't run automatically. **Fix:** on `serve`, if `stats.totalSessions === 0`, print a friendly "indexing N projects for the first time, this takes ~Xs" with a progress bar (the `onProgress` callback at `index-runner.ts:121` is already wired but unused by `serve.ts:27`). Show a non-blocking "Cluster your topics?" nudge once indexed. (effort: **S**)

### 14. Per-model / per-tool drill-down in analytics
`getToolUsage` (`analytics.ts:43`) JSON-parses every assistant row to count tool_use — but throws away *which session/repo* each came from. With #5's model data, "Edit calls per repo" and "which repos use Opus vs Haiku" become trivial group-bys. Reuse the existing parse loop, emit `(repo, tool, model)` tuples. (effort: **S** once #5 lands)

### 15. Saved searches / starred sessions
`db/library.ts` has the tree; a lightweight `starred` table + a star toggle in `SessionListPane.astro` gives users a curation layer above auto-topics. Pairs with `⌘K` ("jump to starred"). YAGNI-adjacent — ship only if users ask. (effort: **S**)

---

## Already good (don't touch)

- **Deterministic segmentation + spine-hash label caching** (`label.ts:38-45`) — correctly avoids re-paying for unchanged sessions; tail-segmenting huge sessions to match the reader (`label.ts:28`) is a sharp detail.
- **Incremental indexing** via mtime+size skip (`index-runner.ts:62`) is correct and fast; malformed-line logging is resilient.
- **Analytics memoization keyed on message-row count** (`analytics.ts:18`) is a clean, correct cache-invalidation signal.
- **Repo-identity capture-before-deletion** (`index-runner.ts:124`) is genuinely thoughtful design.
