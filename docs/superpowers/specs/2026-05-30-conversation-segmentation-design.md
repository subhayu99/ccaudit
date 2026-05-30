# Conversation Segmentation — Design (the "WHAT axis")

**Date:** 2026-05-30
**Status:** Design approved. Layer 1 to be implemented first; Layer 2 captured here as the roadmap and deferred.

## The idea, from first principles

Today the atomic unit is the **session** (one JSONL file). But a single session is rarely one thing — mid-conversation you pivot to a different direction (finish the auth fix, then debug CI, then check Slack). We want to expose those **sub-units** ("subatomic particles") and, eventually, the **threads that link them across sessions**.

Two orthogonal axes:
- **Repo = WHERE you worked** (already built — Layer-1 repo identity).
- **Topic / segment = WHAT you worked on** (this design). One topic can span many sessions and repos; one session can touch many topics.

### Why this is tractable (the key reframe)

A 17k-message / 59 MB session is ~99% tool calls and tool results. **Topic lives only in the dialogue**, and a pivot is almost always authored by *the user*. So the unit of analysis is the **user-turn spine** — the real user-text turns with tool noise stripped. Measured on real data:

| Session | Raw | User-turn spine |
|---|---|---|
| 177270df | 17,282 msgs / 59 MB | **443 turns** |
| e4929da6 | 12,521 msgs | 113 turns |
| f463c063 | 6,621 msgs | 149 turns |

The spine is kilobytes. Whatever segments it (a cheap heuristic or `claude -p`) reads almost nothing.

### Determinism split (same discipline as repo identity)

- **Layer 1 — deterministic boundaries (free, stable, provable):** large wall-clock gaps between user turns ("left and came back"), and `/compact` seams. A prototype over real sessions showed these alone produce *genuinely meaningful* segments — e.g. one session split into "check the PRD pdf" → "backend isn't deployed" → "what did we discuss with Purva?" → "add caching to endpoints" → "check Slack messages". No AI.
- **Layer 2 — semantic (inferred, fuzzy, needs a brain):** the *immediate* pivot (topic changes in the same sitting, no gap, no marker), segment **naming**, and **cross-session topic clustering**. No ground truth → must be labeled a heuristic, **cached/pinned** so it doesn't wobble, and never override Layer-1 structure.

### Why Claude is the Layer-2 engine

Everyone using this tool already has Claude Code. `claude -p` (headless, the user's own auth, on their machine) is a free, **local** semantic engine — no API keys, no embeddings server, nothing leaves the box. It only ever sees the tiny spine.

## Data gotchas (found by prototyping on real data — must handle)

1. **Compaction re-injects earlier turns.** 177270df had 443 spine turns but only **390 unique `uuid`s** — ~53 were old turns re-embedded by `/compact`, producing phantom duplicate segments with backward timestamps (one jumped 154 h). **Mitigation: dedup the spine by `uuid` and sort by timestamp before segmenting.**
2. **Backward time jumps** exist but are rare once deduped. Segment on the deduped, time-sorted spine.
3. **Injected boilerplate** (Conductor `<system_instruction>`, claude-mem observer wrappers) can appear as a segment opener. Run existing `cleanPromptText` on openers (and skip openers that clean to empty).

---

## Layer 1 — deterministic segmentation (implement first)

### Data unit

```ts
type Segment = {
  index: number;           // 0-based order within the session
  startLine: number;       // line_no of the opening user turn
  startedAt: number | null;
  endedAt: number | null;
  turnCount: number;       // user turns in this segment
  opener: string;          // cleaned text of the opening user turn — the free auto-label
  reason: "start" | "gap" | "compact";
  gapMinutes: number | null; // the gap that triggered the boundary (for "gap")
};
```

### Algorithm — `segmentSession(messages, opts)`

Pure function (`src/lib/segment.ts`), no DB, fully unit-testable.

1. **Build the spine:** keep messages where `classifyMessage(m) === "user-text"` and `timestamp != null`.
2. **Dedup by `uuid`** (first occurrence wins); messages with null uuid are kept as-is.
3. **Sort the spine by `timestamp`** (stable; tie-break on `line_no`).
4. Track compact seams: the set of `line_no`s where `isCompactSummary` is true (from the full message list).
5. Walk the spine; start a new segment when, relative to the previous spine turn:
   - the time gap `> gapMinutes` (default **30**), reason `"gap"`; or
   - a compact summary lies between the two turns' `line_no`s, reason `"compact"`.
6. Each segment's `opener` = `cleanPromptText(firstTurn.textContent)`; if empty, fall back to the next non-empty turn, else `"(untitled)"`.

Tunable `opts = { gapMinutes?: number }`. Segments are **always derived at read time** (never persisted as truth) so changing the threshold is instant and nothing goes stale.

### Integration

- **Reader (`SessionReader.astro`):** render labeled **segment dividers** between segments (similar to the existing compact divider) — `▸ <opener> · <time> · N turns`. Add a **segment jump-nav** (a labeled list, reusing/extending the minimap rail) so the divergence points are clickable.
- **Session list / sidebar:** show a session's **segment count** (e.g. a small "5 threads" chip) when > 1. (Expanding a session into its segments in the list is optional polish.)
- Segmentation runs on the already-loaded messages in the reader — **no extra query, no extra cost.**

### Non-goals for Layer 1

No AI, no naming beyond the free opener, no cross-session linking, no persistence. Those are Layer 2.

---

## Layer 2 — semantic enrichment (built on Layer 1)

### Feasibility validated (2026-05-30, prototype on real data)

- `claude -p <prompt> --model haiku --output-format json` works headlessly; parse `.result` (a JSON array). Everyone with Claude Code has this — no API keys, **local**.
- **Label quality with Haiku is excellent.** Real outputs: "Now give me the plan again…" → *Plan Review And Approval*; "I don't want any follow-ups, fix all the gaps…" → *Gaps Closure Requirements*; "I split the single PR into 5…" → *Review Split PRs Comments*.
- **Economics:** ~**$0.03/session**, ~**60 s/session** (the `claude -p` harness startup dominates; a trivial call already costs ~$0.09 on the default model — hence Haiku + one batched call per session). ~$9 / ~4.5 h serial for all 270 → must be **on-demand per session + cached**, optionally a background batch; never a blocking "label everything" button.
- **Hard rules:** one `claude -p` call **per session** (labels all its segments at once), **never per-segment**; cache keyed on a spine signature so we only re-label when the spine changes; labels are AI (non-deterministic) → **pinned, marked as AI, and only annotate** — they never move Layer-1 boundaries.

### Decomposition (each its own plan)

- **2a — Segment naming (do first).** Batched Haiku call names a session's segments; cached; shown in the reader (✨-marked) over the deterministic opener. Proven above.
- **2b — Immediate-pivot detection.** Claude subdivides a long no-gap segment where the topic changed mid-sitting. Annotates only.
- **2c — Cross-session topic threads.** Cluster 2a's labels across all sessions into topics; a new WHAT-axis in the graph/sidebar linking conversations "from one to another."

  **Feasibility validated (2026-05-30):** one `claude -p` (Haiku) call clustered 293 real session titles into clean, meaningful topics in ~177s for **$0.075** — e.g. *Backend Development (48), ccaudit Session Tool (35), Campaign & Email Outreach (30), Data Ingestion Pipeline (30), Groundwork Learning Platform (16), TrueROI Dashboard (10)* plus a *Miscellaneous (70)* catch-all. Cross-session clustering is practical and high-quality.

  **2c implementation outline (for a fresh session):**
  - Clustering engine `clusterTopics(items, {run})` — one batched Haiku call; prompt must return topic + **membership** (each session/segment → topic), not just counts, so the graph can draw edges. Cache/pin results; re-cluster on demand only (it's a global, expensive-ish op).
  - Schema: `topics(id, name, created_at)` + `topic_members(topic_id, session_id [, segment_index])`. Persist; pinned.
  - `/api/cluster` (or CLI `ccaudit topics`) on-demand global action with a cost/confirm note.
  - UI: a **Topics** grouping in the sidebar (topic → sessions) and a graph axis (topic nodes linking sessions across repos) — orthogonal to the repo (WHERE) axis. Topic membership is AI/heuristic → marked, user-overridable.
  - Granularity choice to settle at build time: cluster **sessions** (simpler, proven above) vs **segments** (finer, uses 2a labels, needs all sessions labeled first). Recommend sessions first, segments as a refinement.

Built on the same spine; opt-in; cached.

1. **Segment naming.** One `claude -p` call per session passes the spine + Layer-1 boundaries and asks for a 3–5 word topic label per segment. Cache keyed on session + spine hash; pin results.
2. **Immediate-pivot detection.** Within a long single-sitting segment (no gap), ask Claude whether/where the topic changed; insert sub-boundaries. Clearly labeled as inferred; never moves Layer-1 boundaries, only subdivides.
3. **Cross-session topic threads.** Cluster segment labels across all sessions into topics ("campaign-ROI", "ingestion bug") via Claude. A topic is a new **WHAT-axis** node that links segments/sessions across repos and time.
4. **Graph + UI.** A "Topics" grouping/overlay (orthogonal to repos): topic → segment → session. A topic thread can visibly connect conversations "from one to another."

### Layer 2 constraints

- **Local & opt-in.** Runs `claude -p` only on demand (a "Analyze topics" action or background job), never automatically on index.
- **Incremental & cached.** Only (re)analyze sessions whose spine changed. Persist labels/clusters in new tables; pin so they don't wobble between runs.
- **Cheap.** Claude only ever sees the spine (KB), and judges/ names — it does not re-read transcripts.
- **Heuristic, clearly marked.** Inferred boundaries/labels are visually distinguished from deterministic ones and are user-overridable.

## Testing

- Layer 1: unit tests for `segmentSession` (gap boundary, compact boundary, uuid-dedup of re-injected turns, backward-timestamp sorting, boilerplate-opener cleaning, single-segment short sessions). Reader rendering verified via Playwright on a real multi-segment session.
- Layer 2 (later): deterministic tests around caching/keying + clustering glue; the model output itself is validated by fixture-mocking `claude -p`.

## Success criteria

- **Layer 1:** opening a long session shows clear, labeled segment dividers at real pivot points; sessions show a segment count; threshold change is instant; no phantom duplicate segments from compaction; all derived (zero new storage). Stable across reloads.
- **Layer 2 (later):** segments get readable topic names; related conversations link into cross-session topic threads surfaced in the graph.

## One-line summary

The session is not atomic — its **user-turn spine** (KB, not MB) decomposes into **segments** at deterministic seams (time-gaps, compacts) for free; Claude later **names** those segments and **clusters** them into cross-session **topic threads** — the WHAT-axis that complements the repo (WHERE) axis.
