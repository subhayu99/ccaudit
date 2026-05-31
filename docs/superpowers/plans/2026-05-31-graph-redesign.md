# Graph redesign — two tabs, polished-force aesthetic, color legend

**Status:** APPROVED by user (2026-05-31). User will `/compact` then say "go ahead" — this file is the durable spec; pick it up and execute.

## Goal
Replace today's 3-tab graph (`Folders` / `Repos` / `Topics`) with **two tabs**, both rendered in the
warm "polished-force" aesthetic the user approved (mockups in `/graph-preview`), plus a **color legend
at the top** explaining the node colors.

## The two tabs
1. **Topics** — `topic → session` (the existing `getTopicGraphData`). High-level "what" view. Keep the
   per-hub session cap (`capSessionsPerHub`, newest ~12) for bounded payload.
2. **Hierarchy** ("the galaxy") — `repo → folder(workdir) → session → topic` via
   `getHierarchyGraphData(db, { includeTopics: true })` (already written, `src/db/hierarchy-graph.ts`).
   Topics interconnect sessions across repos/folders (cross-cutting connectors) — this is intended.
   **Default = show everything** (the user liked the dense "galaxy"); hover-focus + zoom navigate it.
   Add a **"show topics" toggle** (default ON) → off gives the clean repo→folder→session tree.

Drop the separate Folders & Repos tabs. (`getGraphData` folders builder becomes unused — may delete;
keep `getRepoGraphData` — `hierarchy-graph.ts` depends on it.)

## Aesthetic (port from the throwaway prototype `src/pages/graph-preview.astro`)
The prototype's `renderForce()` is the reference implementation — port it into the real page.
- **Warm palette, no blue** (user specifically liked these): repo **green `#7fae7a`**, folder/workdir
  **orange `#cf9152`**, session **violet `#9b82d6`**, topic **amber `#d2a85f`**. (See `TYPE` map in the
  prototype: per-type color / hub / glow / radius.)
- Soft **glow filter** on hubs (repo/folder/topic), translucent **halo** behind hubs, **curved links**
  (faint amber), **radial vignette** background, **serif labels** on hubs with a dark stroke.
- **Zoom-to-fit on load** (`fitView()` in prototype — frames `root.getBBox()` via the zoom transform).
- **Hover-to-focus**: dim non-neighbors to ~0.12, brighten node + neighbors, show a tooltip
  (type + count). This is the key to taming Hierarchy density.
- **Drag** nodes (d3-drag), **scroll-zoom / pan** (d3-zoom).

## NEW: color legend (top of the reader pane)
- A row of chips: a colored dot + label per node type **present in the active tab**.
  - Topics tab: `● topic` (amber) · `● session` (violet).
  - Hierarchy tab: `● repo` (green) · `● folder` (orange) · `● session` (violet) · `● topic` (amber).
- Style to match the warm-obsidian UI (small, muted, like the existing graph header counts at
  `graph.astro` legend area). Replaces / sits alongside the current node-count legend.

## Preserve all real wiring (currently in `src/pages/graph.astro`)
- **Click-through**: session → `/s/<id>`; repo → `/?repo=<id.slice(5)>`; workdir → `/?workdir=<path>`;
  topic → `/?topic=<id.slice(6)>`; folder → no-op.
- **Search-highlight** ("Highlight nodes…") INCLUDING the hover-persistence fix already shipped
  (`applyHighlight()` / `labelText()` / `searchQuery` — hover must not relight while a query is active,
  mouse-out restores the filtered state). Re-implement this on top of the new renderer.
- **Recoverable DB-error banner** (the `dbError` branch) and the empty-graph case.
- `capSessionsPerHub` for the Topics tab.

## Files
- `src/pages/graph.astro` — rewrite: 2-tab switcher (`view=topics|hierarchy`, default topics),
  legend, port `renderForce()` (generic `TYPE` map) + `fitView` + hover-focus + drag + curved links +
  search-highlight (with the fix) + click-through + "show topics" toggle (hierarchy only, e.g.
  `?topics=0`). Data: topics → `getTopicGraphData` (capped); hierarchy → `getHierarchyGraphData`.
- `src/db/hierarchy-graph.ts` — already done.
- Sidebar "Graph view" link (`/graph?view=repos`) → point to `/graph` (defaults to topics) or
  `/graph?view=hierarchy`. Check `Sidebar.astro` line ~24.
- **Delete `src/pages/graph-preview.astro`** (throwaway) once ported.
- Optional cleanup: remove now-unused `getGraphData` (folders) + its `folder`/`project` node types if
  nothing else references them (grep first).

## Verify
`npx tsc --noEmit` · `npx astro check` · `npx vitest run` · `npm run build`. Then Playwright on the
built server (:4399): both tabs render, legend chips visible per tab, hover dims the rest, search-
highlight survives hover, a repo/topic click navigates. Screenshot both tabs for the user.

## Notes / decisions already made
- Density: **show everything by default** on Hierarchy (the "galaxy"), not collapse-on-hover.
- Topics-as-connectors across the hierarchy: **yes**, via the force graph (toggleable).
- Colors are final: green / orange / violet / amber as above.
