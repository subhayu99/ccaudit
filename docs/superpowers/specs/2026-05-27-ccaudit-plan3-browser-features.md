# ccaudit Plan 3 — Browser-First Features Spec

**Date:** 2026-05-27
**Status:** Approved

## Scope

Five features that turn the browser UI into a daily-driver tool:

1. **Search page** (`/search?q=...`) — header search box + results page with FTS5 snippets, click-to-jump
2. **Auto-launch** (`ccaudit` no-args) — starts Astro server + opens browser
3. **Stats dashboard** — stats bar on `/` above the sessions table
4. **Resume modal** — `<dialog>` on `/s/[id]` with copyable `cd + claude --resume` command
5. **Auto-reindex on server start** — `indexAll` runs once before first request

## Schema change

Add `cwd TEXT` column to `sessions` table. The indexer already extracts `cwd` from the first message — it's stored in `AggregatorState.cwd` but never persisted to SQLite. Fix: add the column, update `upsertSession` + `Session` type + `rowToSession`, and re-run `reindex --force` to backfill.

## Key decisions

- **No React islands in Plan 3.** All interactivity via native HTML (`<form>`, `<dialog>`, `<details>`, inline `<script>` for clipboard). React arrives only when genuinely needed.
- **Search uses existing `searchMessages` FTS5 query.** No new DB logic.
- **Resume modal cwd** comes from the new `sessions.cwd` column, falling back to the decoded `projectDir`.
- **Auto-reindex** runs in the Astro server middleware on first request only (not on every request). Sets a boolean flag to skip subsequent requests.
- **Playwright verification** after all features — screenshots of `/`, `/search?q=ezcater`, `/s/[id]`, and the resume modal.
