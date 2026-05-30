# ccaudit Overnight Polish — Report

**Scope:** Work the prioritized `docs/audit/BACKLOG.md` (synthesized from the 6-dimension audit),
fixing publish-blockers and crashes first, then UX/performance, then packaging. Orchestrated with
multi-agent fan-out (disjoint-file implementation agents + read-only research) plus serial work on
the interwoven shell pages. Every change verified (`tsc` + `vitest` + `astro check` + `npm run build`)
and committed incrementally on `main`.

**Result:** All 12 P0 items done. 7.5 / 8 P1 items done. Key P2 packaging done. Test suite grew
**201 → 211** and stays green; `tsc` / `astro check` clean; `npm run build` OK; the npm tarball is
correct (47 files, ~678 kB, ships `dist-web/` + `LICENSE`, no source `.ts`).

---

## P0 — correctness / crashes / publish-blockers (12 / 12 done)

| # | Item | Commit | What changed |
|---|------|--------|--------------|
| 1 | Topic-grouped graph | (pre) | `getTopicGraphData` + `/graph?view=topics` (13 topics / 115 sessions verified) |
| 2 | Incremental clustering | (pre) | `/api/cluster` clusters only unclustered sessions; `force` = full re-cluster |
| 3 | `serve` runs built standalone server | `04edeb1` | spawns `node dist-web/server/entry.mjs` (was broken `npx astro dev`) |
| 4 | `files` allowlist + build-web in prepare | `04edeb1` | tarball now ships `dist-web/`; omits `src/*.ts` |
| 5 | Escape FTS `MATCH` | `04edeb1` | `escapeFtsQuery` — ordinary input no longer crashes CLI/MCP/web |
| 6 | Clamp `--limit` | `9744e3b` | `clampLimit` (NaN/neg/huge → default, cap 1000) in CLI search/list + MCP |
| 7 | Harden `claude -p` | `7657adf` | async `runClaude()` (ENOENT/non-JSON/timeout); SSR loop no longer frozen; 504 on timeout, 4xx otherwise |
| 8 | Cluster never wipes on failure + UX | `7657adf` | `force` path only `replaceTopics` on validated non-empty result; spinner + cost note + in-flight guard |
| 9 | Process-wide DB singleton | `efab87b` | `getDb()`/`closeDb()`; perf pragmas once at open; 11 runtime sites converted, all handler `db.close()` removed |
| 10 | Register `ccaudit_regexp` UDF once | `efab87b` | moved into `openDb` (was re-registered per query — would throw on the shared singleton) |
| 11 | Resume cwd shell-injection | `55a3a55` | `posixQuote()`; emit `cd` only when cwd exists; never use the lossy decoded path |
| 12 | Normalize `project_dir` + NaN aggregates | `55a3a55` | `decodeProjectDir` collapses `//`; stats `COALESCE(...,0)` on empty index |

**Why these mattered:** #3/#4/#5 made the published package literally non-functional or crash on
first use. #9/#10 were a latent time-bomb — the regex UDF re-registration would have thrown the
moment a DB singleton landed. #11 was a real shell-injection vector in the resume command.

## P1 — UX & performance (7.5 / 8 done)

| # | Item | Commit | What changed |
|---|------|--------|--------------|
| 1 | Memoize `getLibraryTree` | `7513fe7` | per-connection `WeakMap` cache keyed by `MAX(indexed_at)|count|exclusions-sig`; rebuilds only on change |
| 2 | First-run / empty-index onboarding | `2106791` | Dashboard first-run panel (where ccaudit looked + `CCAUDIT_PROJECTS_DIR` hint); `serve` prints the same |
| 3 | Recoverable DB-error panels | `2106791` | `DbErrorPanel` on home reader, graph error banner, richer "session not found" state |
| 4 | Search N+1 + deep-link | `2106791` | one `getSessionsByIds()` batch (was ≤50 round-trips); hits deep-link `#m<lineNo>` → reader scrolls + highlights |
| 5 | Loading states + clipboard feedback | `9df1878` | top progress bar + in-flight guard on hide/exclude; resume Copy → "Copied ✓" + select-text fallback |
| 6 | Short-circuit empty-exclusion subquery | `7513fe7` | FTS/exact/regex omit `session_id IN (...)` when no exclusions; O(n²) `[...arr,x]` → `push` |
| 7 | Cap graph + ⌘K palette payload | `2106791` | **Palette done** (repos+workdirs + 300 most-recent sessions). **Graph hubs-only/lazy-load: NOT done** (see remaining) |
| 8 | ⌘K polish + touch-reachable hide buttons | `9df1878` | hide buttons always visible/focusable (opacity model); palette scroll-into-view + "no matches" empty row |

## P2 — features & packaging (packaging done; features partial)

| # | Item | Commit | Status |
|---|------|--------|--------|
| 5 | Packaging metadata + LICENSE + cross-platform `open` | `57e5e8b` | **Done** — MIT LICENSE, repo/homepage/bugs/keywords, `0.0.1→0.1.0`, darwin/win32/xdg `open` |
| 6 | `doctor` probes `claude` CLI; prepublish test gate | `57e5e8b` | **Done** — optional WARN for missing `claude`; `prepublishOnly` runs build + tests |
| 2 | `ccaudit stats` / `ccaudit topics` CLI | (final agent) | In-flight at time of writing — see git log for the commit |
| 9 | Code-health cleanups (partial) | (final agent) | Safe subset (search no-op, dead analytics stub) — in-flight |

---

## How it was orchestrated

- **Wave 1 (parallel):** 3 disjoint-file implementation agents (#6; #11+#12; #7+#8) + 1 read-only
  research agent scoping the DB-singleton refactor. One agent failed to emit its structured report
  but its edits were correct on disk — reviewed and a single `tsc` slip (`never.toString()`) fixed.
- **Wave 2 (serial, me):** the #9/#10 DB-singleton refactor — foundational, touches `init.ts` + 11
  call sites that overlapped Wave 1's files, so it could not run concurrently.
- **Wave 3 (parallel):** data-layer agent (#1+#6) + interaction-polish agent (#5+#8) ran while I did
  the interwoven shell-page work (#2/#3/#4/#7-palette). Two minor type errors from agent output
  (`GroupedList` default, a closure-narrowing cast) caught by `astro check` and fixed.
- **Wave 4:** packaging (me) + a final agent for the P2 CLI commands + safe dead-code.

Verification gate after every wave: `npx tsc --noEmit`, `npx vitest run`, `npx astro check`,
`npm run build`. The server-booting smoke test was run 3× to confirm the DB-singleton didn't
introduce flakiness.

## Remaining / known issues (recommended next session)

1. **Graph payload (P1 #7, the heavy half).** The ⌘K palette is now capped, but `/graph` still ships
   every node and janks above ~1–2k nodes. Next: default to hubs-only (repos/folders/topics) and
   lazy-load a hub's session nodes on click via a small `/api/graph?hub=` endpoint; cap/cluster
   sessions per hub above K. Files: `src/db/graph.ts`, `repo-graph.ts`, `topic-graph.ts`,
   `src/pages/graph.astro`.
2. **Token / cost capture (P2 #1) — the killer differentiator.** `message.usage` (full token counts)
   and `message.model` exist in every JSONL but are dropped at index time. Capturing them unblocks an
   AI-spend heatmap, per-topic/per-repo cost, and a `stats` cost column. Files: `src/indexer/extract.ts`,
   `aggregate.ts`, `db/init.ts` (columns), new `src/lib/pricing.ts`.
3. **Topic management (P2 #3):** rename / merge / delete topics without a full re-cluster.
4. **Live file-watcher + SSE (P2 #4):** auto-reindex in-progress sessions; move the middleware
   auto-reindex off the first-request hot path.
5. **RAG "ask your history" + export (P2 #7), reader "Load earlier" + mobile polish (P2 #8),
   remaining code-health (P2 #9), and robustness hardening for oversized JSONL lines / schema
   versioning (P2 #10).**

## Standing constraints honored

- Never wrote to `~/.claude/` (read-only source). Stayed on `main`. Stored/displayed git remotes are
  credential-stripped (verified the `origin` URL carries no token). The publishable tarball excludes
  source and design docs.
