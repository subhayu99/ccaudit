# Conversation Segmentation — Layer 1 (deterministic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose a session into deterministic topic-segments at user-turn time-gaps and compact seams, and surface them in the reader as labeled dividers + a jump-nav — entirely derived, no AI, no new storage.

**Architecture:** A pure `segmentSession(messages, opts)` builds the user-turn spine (via existing `classifyMessage`), dedups by `uuid`, sorts by timestamp, and cuts on `gap > N min` or a compact seam. `SessionReader.astro` computes segments from the messages it already loaded and renders dividers + a segment jump-nav. Nothing is persisted; changing the threshold is instant.

**Tech Stack:** TypeScript, Astro, Vitest, existing `classifyMessage` + `cleanPromptText`.

**Reference:** spec `docs/superpowers/specs/2026-05-30-conversation-segmentation-design.md` (Layer 1 section). Layer 2 (Claude naming + cross-session topic threads) is deferred to its own spec/plan.

**Scope note:** Layer 1 = `segmentSession` + reader integration. NOT in this plan: list/sidebar segment-count chip (fast-follow), any `claude -p` usage, cross-session topic clustering, graph topic axis (all Layer 2).

---

## File Structure

- Create `src/lib/segment.ts` — `Segment` type + `segmentSession(messages, opts)`. One responsibility: deterministic session decomposition. Pure; depends only on `classifyMessage` + `cleanPromptText`.
- Create `tests/segment.test.ts` — unit tests for the algorithm + the real-data gotchas (uuid dedup, backward timestamps, compact seam, boilerplate opener).
- Modify `src/components/SessionReader.astro` — compute segments from loaded messages; render segment dividers between segments + a jump-nav rail.

---

## Task 1: `segmentSession` pure function

**Files:**
- Create: `src/lib/segment.ts`
- Test: `tests/segment.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/segment.test.ts
import { describe, it, expect } from "vitest";
import { segmentSession } from "../src/lib/segment.js";
import type { MessageRow } from "../src/types.js";

const MIN = 60_000;
// A real user-text turn: type "user", string content, not sidechain.
function user(lineNo: number, tsMin: number, text: string, uuid = `u${lineNo}`): MessageRow {
  return {
    sessionId: "s", lineNo, uuid, parentUuid: null, type: "user", role: "user",
    isSidechain: false, isCompactSummary: false, timestamp: tsMin * MIN,
    textContent: text, rawJson: JSON.stringify({ message: { content: text } }),
  };
}
function compact(lineNo: number, tsMin: number): MessageRow {
  return {
    sessionId: "s", lineNo, uuid: `c${lineNo}`, parentUuid: null, type: "user", role: "user",
    isSidechain: false, isCompactSummary: true, timestamp: tsMin * MIN,
    textContent: "summary", rawJson: "{}",
  };
}

describe("segmentSession", () => {
  it("returns a single segment when all user turns are within the gap", () => {
    const segs = segmentSession([user(0, 0, "start the auth fix"), user(2, 10, "now the next bit"), user(4, 20, "and one more")]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.turnCount).toBe(3);
    expect(segs[0]!.opener).toBe("start the auth fix");
    expect(segs[0]!.reason).toBe("start");
  });

  it("cuts a new segment when the gap between user turns exceeds the threshold", () => {
    const segs = segmentSession([user(0, 0, "fix the login bug"), user(2, 45, "different thing: check the PRD")]);
    expect(segs).toHaveLength(2);
    expect(segs[1]!.reason).toBe("gap");
    expect(segs[1]!.gapMinutes).toBe(45);
    expect(segs[1]!.opener).toBe("different thing: check the PRD");
  });

  it("cuts a new segment at a compact seam even within the gap", () => {
    const segs = segmentSession([user(0, 0, "task A"), compact(1, 5), user(2, 6, "continue from the summary")]);
    expect(segs).toHaveLength(2);
    expect(segs[1]!.reason).toBe("compact");
  });

  it("dedups re-injected turns by uuid (compaction artifact)", () => {
    // u0 re-appears later (same uuid) with a backward timestamp — must not create a phantom segment
    const segs = segmentSession([
      user(0, 0, "original task", "dup"),
      user(2, 10, "more work"),
      user(50, 0, "original task", "dup"), // re-injected, same uuid, old ts
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.turnCount).toBe(2); // dup counted once
  });

  it("sorts the spine by timestamp before segmenting", () => {
    const segs = segmentSession([user(0, 100, "later turn"), user(2, 0, "earlier turn")]);
    expect(segs[0]!.opener).toBe("earlier turn"); // earliest first regardless of line order
  });

  it("cleans injected boilerplate from the opener", () => {
    const segs = segmentSession([
      user(0, 0, "<system_instruction>\nYou are working inside Conductor.\n</system_instruction>\n\nFix the build"),
    ]);
    expect(segs[0]!.opener).toBe("Fix the build");
  });

  it("honors a custom gapMinutes", () => {
    const segs = segmentSession([user(0, 0, "a"), user(2, 20, "b")], { gapMinutes: 15 });
    expect(segs).toHaveLength(2);
  });

  it("returns no segments for a session with no user-text turns", () => {
    expect(segmentSession([compact(0, 0)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/segment.test.ts`
Expected: FAIL — `segmentSession` not found / module missing.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/segment.ts
import type { MessageRow } from "../types.js";
import { classifyMessage } from "./message-kind.js";
import { cleanPromptText } from "./clean-prompt.js";

export type Segment = {
  index: number;
  startLine: number;
  startedAt: number | null;
  endedAt: number | null;
  turnCount: number;
  opener: string;
  reason: "start" | "gap" | "compact";
  gapMinutes: number | null;
};

export type SegmentOptions = { gapMinutes?: number };

/**
 * Deterministically decompose a session into topic-segments.
 *
 * Spine = real user-text turns (tool noise stripped via classifyMessage),
 * deduped by uuid (compaction re-injects earlier turns), sorted by timestamp
 * (compaction/resume make timestamps non-monotonic in line order). A new
 * segment starts when the gap to the previous turn exceeds `gapMinutes`, or a
 * compact summary fell between the two turns' line numbers. Pure + derived —
 * never persisted, so changing the threshold is instant.
 */
export function segmentSession(messages: MessageRow[], opts: SegmentOptions = {}): Segment[] {
  const gapMs = (opts.gapMinutes ?? 30) * 60_000;

  // compact seams by line number (from the full, unfiltered message list)
  const compactLines: number[] = messages
    .filter((m) => m.isCompactSummary)
    .map((m) => m.lineNo)
    .sort((a, b) => a - b);
  const compactBetween = (loA: number, loB: number) => {
    const lo = Math.min(loA, loB), hi = Math.max(loA, loB);
    return compactLines.some((c) => c > lo && c < hi);
  };

  // spine: user-text turns with a timestamp, deduped by uuid, time-sorted
  const seen = new Set<string>();
  const spine = messages
    .filter((m) => m.timestamp != null && classifyMessage(m) === "user-text")
    .filter((m) => {
      if (m.uuid == null) return true;
      if (seen.has(m.uuid)) return false;
      seen.add(m.uuid);
      return true;
    })
    .sort((a, b) => (a.timestamp! - b.timestamp!) || (a.lineNo - b.lineNo));

  const segments: Segment[] = [];
  let cur: Segment | null = null;
  let prev: MessageRow | null = null;

  const openerOf = (m: MessageRow) => cleanPromptText(m.textContent ?? "").replace(/\s+/g, " ").trim();

  for (const m of spine) {
    let boundary = false;
    let reason: Segment["reason"] = "start";
    let gapMinutes: number | null = null;
    if (prev) {
      const gap = m.timestamp! - prev.timestamp!;
      if (gap > gapMs) { boundary = true; reason = "gap"; gapMinutes = Math.round(gap / 60_000); }
      else if (compactBetween(prev.lineNo, m.lineNo)) { boundary = true; reason = "compact"; }
    }
    if (!cur || boundary) {
      cur = {
        index: segments.length,
        startLine: m.lineNo,
        startedAt: m.timestamp,
        endedAt: m.timestamp,
        turnCount: 0,
        opener: openerOf(m) || "(untitled)",
        reason,
        gapMinutes,
      };
      segments.push(cur);
    }
    cur.turnCount += 1;
    cur.endedAt = m.timestamp;
    prev = m;
  }

  return segments;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/segment.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segment.ts tests/segment.test.ts
git commit -m "feat(segment): deterministic session segmentation (user-turn spine, gap/compact seams)"
```

---

## Task 2: render segment dividers + jump-nav in the reader

**Files:**
- Modify: `src/components/SessionReader.astro`

- [ ] **Step 1: Import segmentSession and compute segments in the frontmatter**

In `src/components/SessionReader.astro`, add the import alongside the existing ones (after the `cleanPromptText` import line):

```astro
import { segmentSession } from "../lib/segment";
```

Then, immediately AFTER the line that computes `const visible = ...` (the capped visible array), add:

```astro
// Deterministic topic-segments over the messages we loaded. Map each segment's
// opening line to the segment so we can drop a divider before that turn.
const segments = segmentSession(messages);
const segByStartLine = new Map(segments.map((s) => [s.startLine, s]));
```

- [ ] **Step 2: Render a divider before each segment's opening turn**

In the `{blocks.map((b) => (` template loop, the FIRST branch currently handles user/assistant:

```astro
        b.t === "user" || b.t === "assistant" ? (
          <div class={`turn ${b.t}`} id={`m${b.lineNo}`}>
```

Replace that opening of the branch with a version that prepends a segment divider when this block's line starts a segment (skip the very first segment, which is just the session start):

```astro
        b.t === "user" || b.t === "assistant" ? (
          <Fragment>
            {segByStartLine.has(b.lineNo) && segByStartLine.get(b.lineNo)!.index > 0 && (
              <div class="seg-divider" id={`seg${segByStartLine.get(b.lineNo)!.index}`}>
                <span class="seg-dot"></span>
                <span class="seg-label">{segByStartLine.get(b.lineNo)!.opener}</span>
                <span class="seg-meta">{segByStartLine.get(b.lineNo)!.reason === "compact" ? "after compact" : `${segByStartLine.get(b.lineNo)!.gapMinutes}m gap`} · {segByStartLine.get(b.lineNo)!.turnCount} turns</span>
              </div>
            )}
            <div class={`turn ${b.t}`} id={`m${b.lineNo}`}>
              <div class={`role ${b.t}`}>{b.t === "user" ? "● You" : "✦ Claude"}</div>
              <div class="bubble prose-warm" set:html={b.html}></div>
            </div>
          </Fragment>
        ) : b.t === "compact" ? (
```

> Note: this replaces the existing `b.t === "user" || b.t === "assistant" ? ( ... )` block (which rendered the `<div class="turn">` directly). The `<Fragment>` wrapper is needed because Astro JSX expressions must have a single root. Import is implicit (`Fragment` is a built-in Astro global).

- [ ] **Step 3: Add a segment jump-nav rail (next to the minimap)**

Find the existing minimap block:

```astro
    {landmarks.length > 1 && (
      <div class="mini">
```

Immediately BEFORE it, add a labeled segment rail (only when there's more than one segment):

```astro
    {segments.length > 1 && (
      <nav class="seg-nav" aria-label="segments">
        <div class="seg-nav-head">{segments.length} threads</div>
        {segments.map((s) => (
          <a class="seg-nav-item" href={`#${s.index === 0 ? `m${s.startLine}` : `seg${s.index}`}`}>
            <span class="seg-nav-dot" data-reason={s.reason}></span>
            <span class="seg-nav-text">{s.opener}</span>
          </a>
        ))}
      </nav>
    )}
```

- [ ] **Step 4: Add the styles**

In the `<style>` block of `SessionReader.astro`, append:

```css
  .seg-divider { display:flex; align-items:center; gap:10px; margin:30px 0 20px; padding-top:6px; border-top:1px solid var(--border); max-width:74ch; }
  .seg-dot { width:9px; height:9px; border-radius:50%; background:var(--violet); flex:none; }
  .seg-label { font-family:var(--serif); font-size:15px; color:var(--text); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .seg-meta { margin-left:auto; font-size:11px; color:var(--text-faint); font-family:var(--mono); white-space:nowrap; }
  .seg-nav { position:absolute; right:26px; top:96px; width:200px; max-height:70vh; overflow-y:auto; background:var(--panel); border:1px solid var(--border-soft); border-radius:10px; padding:8px; font-size:12px; }
  .seg-nav-head { font-size:10.5px; text-transform:uppercase; letter-spacing:.1em; color:var(--text-faint); padding:4px 6px 6px; }
  .seg-nav-item { display:flex; align-items:center; gap:7px; padding:5px 6px; border-radius:6px; color:var(--text-dim); text-decoration:none; }
  .seg-nav-item:hover { background:var(--panel-2); color:var(--text); }
  .seg-nav-dot { width:6px; height:6px; border-radius:50%; flex:none; background:var(--violet); }
  .seg-nav-dot[data-reason="compact"] { background:var(--c-orange); }
  .seg-nav-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
```

(The right-edge `.mini` minimap and `.seg-nav` coexist; the nav sits inboard of the thin minimap. If they visually collide during Playwright review, nudge `.seg-nav { right:26px }` or hide `.mini` when `.seg-nav` is present — adjust then.)

- [ ] **Step 5: Typecheck + build**

Run: `npx astro check && npm run build:web`
Expected: 0 errors; "Complete!".

- [ ] **Step 6: Commit**

```bash
git add src/components/SessionReader.astro
git commit -m "feat(reader): show deterministic segment dividers + thread jump-nav"
```

---

## Task 3: full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit && npx astro check`
Expected: all tests pass; tsc exit 0; astro check 0 errors.

- [ ] **Step 2: Playwright visual check on a real multi-segment session**

```bash
npm run build && npm run build:web
PORT=4399 HOST=127.0.0.1 node ./dist-web/server/entry.mjs &
# open /?session=f463c063-9cbd-42f0-89a7-ce72e8a00c69 (149-turn spine, real pivots)
```
Drive the playwright-skill to screenshot the reader at 1440×900. Confirm: segment dividers appear at pivot points with cleaned opener labels, the "N threads" jump-nav lists segments and scrolls to them, no phantom/duplicate dividers. Stop the server after.

- [ ] **Step 3: Commit any visual tweaks**

```bash
git add -A && git commit -m "chore(reader): segment divider/nav visual polish from Playwright review"
```

---

## Self-Review

- **Spec coverage (Layer 1):** spine = user-text turns ✓ (Task 1 filter); dedup by uuid ✓; time-sort ✓; gap + compact seams ✓; opener via cleanPromptText ✓; derived/no-storage ✓ (pure fn, computed in reader); tunable threshold ✓ (`gapMinutes`); reader dividers + jump-nav ✓ (Task 2). Deferred per spec: list segment-count chip, all Layer 2.
- **Placeholders:** none — full code in every step.
- **Type consistency:** `Segment` fields (`index`, `startLine`, `startedAt`, `endedAt`, `turnCount`, `opener`, `reason`, `gapMinutes`) defined in Task 1 are exactly those referenced in Task 2's template. `segmentSession(messages, opts)` signature matches its use (`segmentSession(messages)`).
- **Note:** Task 2 wraps the user/assistant branch in `<Fragment>` to keep a single JSX root while prepending the divider — required by Astro.
