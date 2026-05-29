# ccaudit UI/UX Redesign — Design (warm-obsidian power-tool)

**Date:** 2026-05-29
**Status:** Design approved. Implementation pending (phased plan to follow).
**Mockup:** `assets/2026-05-29-ui-redesign-mockup.html` (+ `.png`)

## Problem

The current UI is functional but reads as a generic, unstyled admin scaffold — the user's verdict was "clunky and shit." Concretely, observed via a full Playwright audit of every page:

1. **No information hierarchy.** Home dumps all ~278 sessions into one flat, infinitely-scrolling table; Projects is a second flat table. No grouping (repo/date), no filtering, no "what matters now."
2. **Generic default-Tailwind look.** White cards, slate borders, single blue accent, cramped 13px tables. No typographic rhythm or identity.
3. **Noise leaks into the most visible spots.** Home titles are dominated by claude-mem observer boilerplate (`Hello memory agent, you are continuing to observe…`); the session reader's timeline rail is full of `<observed_from_primary_session>`, `<command-name>/context</command-name>` tokens.
4. **The graph (the standout feature) is unreadable.** Nodes sprawl past the canvas, clip at edges, labels overlap, large "compacted" blobs dominate.
5. **Analytics is the nicest page but isolated** and its heatmap is tiny.
6. **Light-mode default** despite the user living in dark mode.

The data layer is strong (Layer-1 repo identity, FTS search, graph data). What's missing is **information architecture** and **craft**.

## Goals

- Reimagine ccaudit as a **power-tool for browsing your Claude history as a knowledge base** — Obsidian/IDE DNA.
- **Repo-first IA** built on the existing Layer-1 repo-identity components.
- A real **design system** in a warm-obsidian aesthetic, **dark-first**.
- Kill boilerplate noise at the source so titles and the reader show real content.
- Make the graph legible.

## Non-goals (YAGNI)

- No mobile-first layout (desktop localhost tool; mobile = graceful degrade only).
- No auth, multi-user, or remote hosting.
- No AI enrichment / "ask your history" chat (separate future work).
- No new data captured beyond what the indexer already stores.
- Keep the CLI and MCP server as-is (this is a web-UI redesign).

## Aesthetic — warm-obsidian design system

Dark-first; a warm parchment light theme is secondary. Tokens (from the approved mockup), to live in Tailwind v4 `@theme` / CSS custom properties:

| Token | Dark | Role |
|---|---|---|
| `--canvas` | `#1b1916` | app background |
| `--panel` | `#211e19` | sidebar |
| `--panel-2` | `#26221b` | list pane / cards |
| `--raise` | `#2d2820` | active/raised surfaces |
| `--border` / `--border-soft` | `#37312a` / `#2b2620` | hairline borders |
| `--text` / `--text-dim` / `--text-faint` | `#ece5d6` / `#a39a87` / `#6f685b` | text ramp |
| `--amber` / `--amber-bright` | `#d2a85f` / `#e6bd76` | primary accent (user turns, CTAs) |
| `--violet` | `#9b82d6` | graph / workdirs / assistant |
| `--green` | `#7fae7a` | repo identity |
| `--orange` | `#cf8a4a` | compaction markers |
| `--blue` | `#6fa1d8` | sessions (graph) |

Type: **serif** (`Iowan Old Style`/`Palatino`/Georgia stack) for titles & section heads; **sans** (system/Inter) for body/UI; **mono** (`SF Mono`/`ui-monospace`) for code, paths, counts. Radii ~8–12px, soft shadows, generous-but-tight spacing.

Light theme: warm cream (`#f5f1e8`) canvas, same accent ramp — equal-quality but secondary.

## Architecture — 3-pane "second brain" shell

A persistent app shell (`AppShell.astro` layout) replaces the current top-nav-only layout. Three columns:

```
┌── Sidebar (264px) ──┬── List (372px) ──┬──────── Reader (flex) ────────┐
│ brand + ⌘K search   │ selection header │ session header + Resume       │
│ Library: Recent /   │ + filter chips   │ de-noised transcript reader   │
│   All / Graph /      │ date-grouped     │ + minimap rail                │
│   Analytics          │ session cards    │ (empty → dashboard)           │
│ Repositories tree:   │                  │                               │
│   repo▸workdir▸sess  │                  │                               │
│ footer: hidden/theme │                  │                               │
└─────────────────────┴──────────────────┴───────────────────────────────┘
```

**Responsive collapse:** below ~1100px the list becomes a slide-over and the reader goes full-width; below ~720px the sidebar collapses to an icon rail / drawer.

### Units (each one purpose, testable)

- **`AppShell.astro`** — the 3-pane grid, theme bootstrap (dark default, persisted), keyboard wiring. Replaces `Base.astro` as the primary layout.
- **Sidebar tree (island)** — renders Library links + repo→workdir→session tree from a new `getLibraryTree(db)` (built on `computeRepoComponents` + sessions). Collapsible; deleted workdirs dimmed; active-selection state from the URL. Hidden-dir management + theme toggle in the footer.
- **`getLibraryTree(db)`** (new `src/db/library.ts`) — pure-ish: returns repos (visible components) → workdirs (with `existsOnDisk`) → session stubs (id, cleaned title, time, msg/compact counts), honoring exclusions. Unit-tested.
- **Session list pane** — server-rendered for a selection (`?repo=`, `?workdir=`, `recent`, `all`, or search). Date-grouped cards. New `listSessionsGrouped(db, selection)` returning `{ group, sessions[] }`.
- **Reader pane** — refactor of `s/[id].astro` into the shell; serif header, metadata row, Resume (uses exact `cwd`), conversation bubbles, de-noised minimap. Reuses message classification.
- **Command palette (island)** — ⌘K overlay: fuzzy jump to repos/sessions + full-text search entry; results route into the list pane. Wraps existing search functions.
- **Graph mode** — full-bleed route reusing `getGraphData`/`getRepoGraphData`; fix force params + **zoom-to-fit on load**, cluster strength so components don't clip; repo view default.
- **Dashboard (empty reader state)** — stats + larger activity heatmap + tool-usage bars (from `analytics.ts`) + recent threads. Subsumes the standalone Analytics page.

## Noise cleanup (extends existing work)

Generalize the boilerplate handling beyond Conductor:

- Extend `cleanPromptText` (or add sibling matchers) to strip leading **claude-mem observer** prefixes: `Hello memory agent, you are continuing to observe…`, `<observed_from_primary_session>…</observed_from_primary_session>`, `<task-notification>`, `<user_request>` wrappers.
- Extend `classifyMessage` so `<command-name>…</command-name>`, `<local-command-caveat>`, and observer-wrapper turns classify as **noise** (hidden by default, behind "show system").
- All anchored/signature-matched (never strips genuine mid-conversation mentions). `raw_json` always preserved. Backfill derived titles for already-indexed rows whose source files are gone.

## Data flow

SSR per navigation (selection lives in the URL: `/?repo=…&workdir=…&session=…` or dedicated routes). better-sqlite3 queries unchanged in spirit; new read helpers (`getLibraryTree`, `listSessionsGrouped`) compose existing modules + `exclusionCondition`. Interactive islands (tree expand/collapse, ⌘K, graph, theme) hydrate client-side; everything degrades to working links without JS where feasible.

## Error / edge handling

- Empty index → friendly empty state in all three panes.
- Session with no `cwd` → reader still renders; Resume falls back to `projectDir` (as today) with a note.
- Deleted-workdir sessions → shown, dimmed, labelled "deleted"; Resume warns the dir is gone.
- Huge sessions (11k+ msgs) → reader virtualizes/paginates the transcript (render in chunks) to stay responsive.

## Testing

- Unit (vitest): `getLibraryTree`, `listSessionsGrouped`, extended `cleanPromptText` + `classifyMessage` (RED→GREEN, as established).
- Existing astro-smoke extended to boot the shell and assert each pane renders for a seeded db.
- Playwright visual verification per phase (the user drives / approves): shell, list grouping, reader de-noise, graph zoom-to-fit, ⌘K, light/dark.

## Phasing (for the implementation plan)

1. **Design system + AppShell** — tokens, dark-first theme, 3-pane layout, nav scaffold. Nothing functional lost.
2. **Sidebar tree + library data** — `getLibraryTree`, repo→workdir→session navigation, hidden-dir mgmt moves here.
3. **Session list pane** — date-grouped cards, filters, selection via URL.
4. **Reader** — refactor session view into the shell; noise cleanup (observer + command tokens); large-session chunking.
5. **Command palette (⌘K)** + search integration.
6. **Graph mode** — full-bleed, zoom-to-fit, clustering fixes.
7. **Dashboard** empty-state (heatmap + tools + recent), retire standalone Analytics/Projects pages.
8. **Polish pass** — light theme parity, responsive collapse, motion, a11y, final Playwright sign-off.

## Success criteria

- First screen shows a navigable, repo-grouped library — no wall of 278 rows.
- Zero boilerplate titles in the list; reader rail shows only real turns by default.
- Graph fits its canvas with no clipping on load.
- Dark-first, warm-obsidian throughout; the user's "fucking beautiful" reaction holds across all pages.
- All existing tests green; new units covered; Playwright-verified per phase.
