# ccaudit — UX & Product Audit

Walked the user flows by reading the .astro shell, panes, palette, graph, and the two AI endpoints. Prioritized below. Effort: S (<1h), M (half-day), L (1-2 days).

---

## P0 — Bugs / correctness / blocking

### P0.1 — `/api/cluster` is a 3-min fully-blocking POST with zero progress, and the dev server will likely time out / look hung
`src/pages/api/cluster.ts:12-32`, trigger `src/components/Sidebar.astro:104-116`.
The handler synchronously runs `clusterTopics()` (a `claude -p` shell-out, ~3 min) inside the request. The browser fetch has no timeout UI, no progress, no abort, and the button just says "✨ Clustering…" with no ETA. On `astro dev` (the actual serve path, `src/cli/serve.ts:36`) a single 3-min request blocks one worker and the user has no signal it's alive vs. dead — many will assume it crashed and reload, which silently kills the in-flight `claude` process.
Fix: make it a job. POST returns `{ jobId }` immediately and spawns the cluster in the background (in-memory job map keyed by id, or write status rows to a `cluster_jobs` table). Add `GET /api/cluster?job=<id>` that the button polls every 2s, updating text to "Clustering 142 sessions… ~2 min". On done, refresh. At minimum (S): show an inline note "This takes ~3 min and ~$0.08, keep this tab open" the moment it's clicked, and a spinner, so the blocking is *expected* rather than alarming. Proper async is M.

### P0.2 — Re-cluster wipes all topics wholesale; a failed/aborted run loses existing topics with no undo
`src/pages/api/cluster.ts:23-24` (`replaceTopics`), button label `src/components/Sidebar.astro:27` ("Re-cluster").
`clusterTopics()` runs first, then `replaceTopics()`. If the user re-clusters and the new run produces worse groupings (or they abort), the old topics are gone. There's also no incremental path: clustering 500 sessions every time is the whole $0.08/3-min cost even when only 3 sessions are new (this is already tracked in task #31).
Fix: cluster only un-topiced sessions by default (diff `items` against existing `topic_sessions`), keep a "Re-cluster all" as an explicit secondary action, and don't `replaceTopics` until the new set is validated/non-empty. M.

### P0.3 — Empty index / first-run shows a confusing all-zeros dashboard, not onboarding
`src/components/Dashboard.astro:34-72`, `src/pages/index.astro:57`.
On a fresh machine where indexing found nothing (or `~/.ccaudit/index.db` is empty), the home renders "Your Claude history" with `0 sessions / 0 messages`, an empty heatmap, and an empty tool-usage list. The sidebar shows empty Library/Repos. There is no "no sessions indexed yet — run `ccaudit reindex` / check `~/.claude/projects`" message. `serveCommand` (`src/cli/serve.ts:24-33`) prints "0 indexed, 0 skipped" to the terminal but the web UI never surfaces this.
Fix: in `Dashboard.astro`, when `stats.totalSessions === 0`, render a dedicated first-run panel (where ccaudit looked, how to point it elsewhere, link to docs) instead of zeroed widgets. S.

### P0.4 — Resume "Copy" button gives no confirmation and silently swallows clipboard failures
`src/components/SessionReader.astro:248-250`.
`navigator.clipboard.writeText(resumeCmd)` is wrapped in `try {} catch {}` with no feedback either way. On HTTP origins (this serves over `http://127.0.0.1`, which is a secure context so it's usually fine) or when permission is denied, the user clicks Copy, nothing happens, and they don't know if it worked.
Fix: flip button text to "Copied ✓" for 1.5s on success; on failure select the `<pre>` text as a fallback. S.

---

## P1 — UX / perf / quality

### P1.1 — "Name threads" is a per-session manual click; AI labels are invisible until the user discovers the tiny "✨ Name" button
`src/components/SessionReader.astro:142-154` (button only in the seg-nav header, only when `segments.length > 1`).
The whole AI-naming feature hides behind a 10.5px button inside a right-rail nav that itself only appears for multi-thread sessions. A user reading a single long session never sees it. There's no batch "name all sessions" and no indication that naming is even possible from the list pane. The button reloads the whole page on success (`:236 location.reload()`) instead of patching labels in.
Fix: (1) surface a one-line affordance in the reader header ("Name the N threads in this conversation with AI · ~60s") so it's discoverable; (2) on success, fetch returns labels — update the seg-nav and dividers in-place instead of full reload; (3) consider auto-naming opportunistically (queue) so labels exist before the user asks. M.

### P1.2 — No loading state anywhere — every action is a hard `location.reload()` / `window.location.href`
`Sidebar.astro:113` (cluster), `:133` (hide), `SessionReader.astro:236` (name), `projects.astro:80` (exclude).
Every mutation does a full navigation. Hiding a repo, un-hiding a directory, naming threads — all blank the page and re-render server-side. On a large index this is a visible flash and loses scroll position in the (potentially long) sidebar/list. The hide button disables itself but gives no spinner.
Fix: at minimum add a subtle top progress bar / disabled overlay during these fetches. Better (M): patch the DOM (remove the hidden repo node, swap labels) and skip the reload. S for the progress bar.

### P1.3 — Topics and AI spend are completely absent from the Dashboard and Graph
`Dashboard.astro` (stats are sessions/messages/compacts only, :39-46), `graph.astro:30-36` (legend is repos/workdirs/folders only).
The product's headline features — cross-session topics and AI labeling cost — are invisible on the two "overview" surfaces. The dashboard never shows topic count or the cumulative `costUsd` already stored in `labels`/topics tables (`db/labels.ts:17`). The graph has a "Repos" and "Folders" axis but no "Topics" axis (also task #32), so the clustered topics can't be explored visually.
Fix: (1) add a "Topics" stat card + a small topic list with session counts to the dashboard; (2) add a "Total AI spend: $X across N labelings" line sourced from `SUM(costUsd)`; (3) add a `view=topics` tab to the graph. M.

### P1.4 — Discoverability: critical actions are hover-only and easy to miss
`Sidebar.astro:87-90` — `.hide-btn { display:none }` until `.lib-item:hover`; the count swaps out on hover (`:90 .ct { display:none }`).
Hide-repo/hide-workdir only appear on hover, are touch-inaccessible (mobile can't hover → can't hide from the sidebar at all), and there's no tooltip explaining the count→✕ swap. Session-node labels in the graph are also hover-only (`graph.astro:199` comment). Segments/threads as a concept are never explained.
Fix: keep hide buttons always-visible at low opacity (or a `⋯` overflow menu), and ensure the `/projects` page (which *is* touch-accessible) is discoverable — the "⌫ Hidden" footer link (`Sidebar.astro:65`) is cryptic. S.

### P1.5 — ⌘K palette has no keyboard scroll-into-view and no result count / empty state
`CommandPalette.astro:71-78`.
Arrow-key navigation updates `aria-selected` but never `scrollIntoView`, so on a long result list (capped at 30, `:60`) the selected item scrolls off-screen and the user navigates blind. There's no "no results" message when a query matches nothing (the list just goes empty except the synthetic "Search history" row). Also `⌘K` toggles open *and closed* (`:72`), which is unusual — most users expect Esc to close.
Fix: call `li.scrollIntoView({block:'nearest'})` on selection change; render a muted "No jumps — press ↵ to full-text search" row. S.

### P1.6 — Session list pane has only a flat empty string and no count/filter/sort affordances
`SessionListPane.astro:14-16` ("No sessions here.").
The middle pane shows grouped sessions but no total count for the current selection, no sort control (always default order), and no way to filter within a repo (e.g., "only sessions with compacts"). For a repo with 200 sessions the user scrolls a wall of cards. The header (`:9-12`) shows title/subtitle only.
Fix: add a result count next to the header and a tiny sort/filter row (recent · most messages · has compacts). M.

### P1.7 — Reader truncates to the latest 500 turns with no way to load earlier history in-app
`SessionReader.astro:41-43`, note at `:110-111`.
Sessions over 500 visible turns silently drop the *beginning* (the most context-rich part for auditing). The note says history is "preserved in the session file" but offers no in-app path to it — defeating the audit use-case for long sessions. Tail-loading (`RAW_TAIL=2500`, `:21`) compounds this: a 17k-message session never even reads its early messages from DB.
Fix: add a "Load earlier" button at the top that fetches the prior window, or paginate by segment. The minimap (`:157-163`) implies the user wants to navigate the whole thing. M-L.

### P1.8 — Search results always link with bare `/?session=` and drop the user's current selection/context
`search.astro:77` (`href={/?session=${h.sessionId}}`), vs. index's careful `selParams` preservation (`index.astro:36-44`).
Clicking a search hit jumps to the session but resets the sidebar/list to the default "recent" view, losing whatever repo/topic the user was in. Also the hit links don't deep-link to the matching `lineNo` — the snippet shows `line {lineNo}` (`:81`) but the reader has `id={m${b.lineNo}}` anchors (`SessionReader.astro:123`) that go unused.
Fix: append `#m<lineNo>` to the href so the reader scrolls to the match; optionally carry repo context. S.

### P1.9 — Mobile: cluster/hide/name flows and the right-rail seg-nav are broken or invisible on small screens
`AppShell.astro:55-64` (responsive), `SessionReader.astro:183` (`.seg-nav { position:absolute; right:26px; width:200px }`), `.mini`/seg-nav overlap the reader on narrow widths.
The seg-nav and `.mini` minimap are absolutely positioned over the reader content and have no mobile treatment — on a phone they overlap text. Hide buttons are hover-only (P1.4) so unusable on touch. The drawer closes on any sidebar `<a>` tap (`AppShell.astro:74-76`), which means tapping the caret-expand also closes the drawer (the caret is a `<button>` inside an `<a>`, `Sidebar.astro:43-44`, so the parent link navigates AND closes — expanding a repo on mobile is impossible).
Fix: hide `.seg-nav`/`.mini` under 900px (or make them a collapsible bottom sheet); stop the caret from triggering navigation on mobile. M.

### P1.10 — No error/loading state when the index DB is missing or a query throws in non-search pages
`index.astro:20-32`, `Dashboard.astro:8-12`, `graph.astro` all call `openDb(INDEX_DB_PATH)` with no try/catch.
Only `search.astro:28-30` wraps queries in try/catch. If `~/.ccaudit/index.db` is missing/corrupt, the home page, dashboard, and graph throw a raw Astro 500 instead of a friendly "run `ccaudit reindex`" screen.
Fix: wrap DB access in the shell pages and render a recoverable error panel. S-M.

---

## P2 — Features / nice-to-have

### P2.1 — No "name all / cluster" cost transparency or running total in the UI
`api/label.ts:48-49`, `api/cluster.ts:23` both compute `costUsd` but it's never shown back to the user post-action.
Fix: toast "Named 6 threads · $0.004" after labeling; persist and total on dashboard (ties to P1.3). S.

### P2.2 — Topic view doesn't show *why* sessions were grouped or let the user rename/merge topics
`index.astro:28-29` (topic selection), `Sidebar.astro:32-38`.
Topics are AI-named and immutable. A user who disagrees with a grouping can only nuke everything and re-cluster (P0.2). Fix: inline-rename a topic, move a session between topics, hide a topic. M.

### P2.3 — Resume is copy-paste only; no one-click resume despite an existing resume API route
`SessionReader.astro:165-172` (dialog with copy), but `src/pages/api/sessions/[id]/resume.ts` exists.
There's a resume endpoint yet the UI only offers a copyable `cd … && claude --resume` string. If the endpoint can actually launch/return a resume target, wire a real "Resume" button. Verify what the route does. S-M.

### P2.4 — Graph has no path from a node to its sessions list / reader
`graph.astro` nodes show tooltips (`:238-240`) but (from the read) clicking a repo/workdir node doesn't navigate to `/?repo=…`.
Fix: make node click navigate to the corresponding library selection so the graph is a real entry point, not just a picture. S.

### P2.5 — `analytics.astro` is a dead redirect stub; `/graph` and `/search` re-query the full library tree per request
`analytics.astro:1-4` (pure redirect — fine but leaves a stale route), `search.astro:20`, `projects.astro:14`, `graph.astro` each call `getLibraryTree(db)` to render the sidebar on every page load.
Fix: minor — acceptable for a local tool, but if the tree is expensive, cache it per-process. The sidebar duplication is the bigger smell. S.

---

## Already good

- The 3-pane shell + mobile off-canvas drawer structure (`AppShell.astro`) is clean and the `mobileMain` switching (reader vs list) is a thoughtful touch.
- Selection-preserving session links on the home page (`index.astro:36-44`) — correct attention to not resetting context (which search.astro then forgets, P1.8).
- Search has proper error handling, three honest modes with descriptions, and empty/no-result states (`search.astro:63-71`) — the best-handled page in the app.
- Tail-loading + 500-turn cap to avoid shipping multi-MB pages (`SessionReader.astro:19-43`) is the right instinct (just needs an escape hatch, P1.7).
- Lossless, reversible directory hiding with a dedicated management page (`projects.astro`) is a nice mental model.
