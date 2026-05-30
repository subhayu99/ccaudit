# Overnight Polish & Audit — Master Plan (autonomous)

**Mandate:** User is asleep ~3–4h. Make ccaudit a polished, publish-ready package/CLI-that-spawns-a-frontend. Audit everything, fix what's needed, improve UX/UI, add high-value improvements. Work autonomously, commit incrementally, never leave broken. This file is the durable script — survives /compact.

## Explicit user asks (P0 — certain, do regardless of audit)

1. **Topic-grouped graph.** The graph must group by the actual topic clusters: a Topics axis — `topic → session` (and/or `topic → repo → session`). New graph mode/view selectable like Folders/Repos. Reuse `getGraphData`/`getRepoGraphData` patterns; add `getTopicGraphData` from `topics`/`topic_members`.
2. **Incremental clustering.** Today `/api/cluster` → `replaceTopics` wipes & re-clusters ALL. Change to incremental:
   - Cluster only **unclustered** sessions (not in `topic_members`); pass them + **existing topic names** to Claude; assign each new session to an existing topic or a new one; **insert** members (don't wipe).
   - Full re-cluster only when `force` is set. Add `force` to `/api/cluster` + a "Re-cluster all" vs default "Cluster new" affordance.
   - Surface cumulative AI **spend** (sum `cost_usd` from `segment_labels` + a topics cost log) somewhere small.

## Audit (fan-out agents → `docs/audit/*.md` → `docs/audit/BACKLOG.md`)

Dimensions: architecture/code-quality, performance/scalability, UX/product critique, robustness/edge-cases, packaging/publish-readiness, feature opportunities. The workflow writes a prioritized `BACKLOG.md` (P0 bugs / P1 UX+perf / P2 features+packaging, each with effort S/M/L + concrete steps).

## Execution order (after audit returns)

1. **P0:** incremental clustering, topic graph, + any correctness/bug findings from the audit.
2. **P1:** UX/UI from audit — likely: clustering progress/async UX (3-min blocking POST is fragile), thread-naming flow (batch/auto), empty/loading/error states, mobile polish, topic management (rename/merge/delete), dashboard surfacing topics + spend.
3. **P2:** publish-readiness (package.json `files`/`bin`/`prepare`, `npx ccaudit` first-run UX, `.npmignore`, version, LICENSE), plus any high-value features.

## Guardrails

- **Stay on `main`** (user's standing choice). Commit per logical change with clear messages. Never leave the tree broken.
- **Verify every change:** `npx vitest run` + `npx tsc --noEmit` + `npx astro check`; Playwright-screenshot UI changes (server on :4399, kill stale first).
- TDD the pure/logic units; verify UI visually.
- AI calls cost money + ~60s–3min — keep them opt-in, cached, incremental; never block the whole UI.
- **Finish with `docs/audit/REPORT.md`**: everything done, before/after, remaining/known-issues, and a recommended next session.

## State at start (for post-compact me)

- Done this session: repo identity (Layer 1), warm-obsidian 3-pane redesign (browse/reader/⌘K/graph/search/directories/dashboard, responsive), perf fixes (memoized analytics, tail-loading, single tree), Conductor/observer/command title cleanup, conversation segmentation **Layer 1** (deterministic) + **2a** (AI naming, cached) + **2c** (topic clustering: `topics`/`topic_members`, `/api/cluster`, sidebar Topics, topic browse).
- 169 tests green, tsc/astro clean, tree clean at start.
- Key files: `src/labeling/{label-segments,cluster-topics}.ts`, `src/db/{topics,labels,library,graph,repo-graph}.ts`, `src/lib/segment.ts`, `src/components/{Sidebar,SessionReader,SessionListPane,Dashboard}.astro`, `src/pages/{index,graph,search,projects}.astro`, `src/pages/api/{label,cluster,exclusions}.ts`.
- Open design item: Layer 2b (immediate same-sitting pivot detection) — optional.

## Progress log
- ✅ P0 incremental clustering (commit) — `/api/cluster` default incremental, `force` full re-cluster, `addToTopics`/`assignNewSessions`. Sidebar "Cluster new".
- ✅ P0 topic graph (commit) — `getTopicGraphData`, Topics tab in `/graph?view=topics` (topic→session), verified 13 topics/115 sessions.
- ⏳ Audit workflow running (wf_57121064-51a) → writes docs/audit/*.md + BACKLOG.md.
- NEXT (post-audit): work BACKLOG P0→P1→P2; verify each; finish with docs/audit/REPORT.md.
