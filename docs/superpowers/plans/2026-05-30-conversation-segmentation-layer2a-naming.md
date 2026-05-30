# Conversation Segmentation — Layer 2a (segment naming via Claude) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name a session's deterministic segments with one batched, cached `claude -p` (Haiku) call, on demand, and show the AI labels (✨-marked) in the reader over the raw openers.

**Architecture:** A pure-ish `labelSegments(segments, {run})` builds one prompt for all segments and parses a JSON array of labels (the `claude` invocation is injected so it's testable). Labels are cached in a `segment_labels` table keyed on a **spine hash** (re-label only when the spine changes). An `/api/label` POST runs it server-side; the reader shows cached labels and offers a "✨ Name threads" button. Labels are AI/non-deterministic → pinned, marked, annotate-only.

**Tech Stack:** TypeScript, better-sqlite3, Astro API route, `claude -p --model haiku --output-format json`, Vitest. Validated: ~$0.03 + ~60s per session, Haiku quality excellent.

**Reference:** spec `docs/superpowers/specs/2026-05-30-conversation-segmentation-design.md` (Layer 2 → 2a).

**Scope note:** 2a = naming only. NOT here: immediate-pivot detection (2b), cross-session topic clustering / graph axis (2c), batch CLI command.

---

## File Structure

- Create `src/labeling/label-segments.ts` — `buildLabelPrompt`, `parseLabels`, `labelSegments` (injectable `run`), default `claude -p` runner.
- Create `src/db/labels.ts` — `spineHash(segments)`, `getLabels(db, sessionId)`, `saveLabels(db, rec)`.
- Modify `src/db/init.ts` — add `segment_labels` table.
- Create `src/pages/api/label.ts` — POST `{sessionId}` → segment, cache-check, label, save, return.
- Modify `src/components/SessionReader.astro` — load cached labels; show them in nav/dividers; add the "Name threads" button.
- Tests: `tests/labeling.test.ts`, `tests/labels-db.test.ts`.

---

## Task 1: `labelSegments` — prompt build + parse + injected runner

**Files:**
- Create: `src/labeling/label-segments.ts`
- Test: `tests/labeling.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/labeling.test.ts
import { describe, it, expect } from "vitest";
import { buildLabelPrompt, parseLabels, labelSegments } from "../src/labeling/label-segments.js";
import type { Segment } from "../src/lib/segment.js";

function seg(index: number, opener: string): Segment {
  return { index, startLine: index * 2, startedAt: 0, endedAt: 0, turnCount: 1, opener, reason: "gap", gapMinutes: 30 };
}

describe("buildLabelPrompt", () => {
  it("numbers each segment opener and asks for a JSON array", () => {
    const p = buildLabelPrompt([seg(0, "fix the login bug"), seg(1, "deploy to staging")]);
    expect(p).toContain("1. fix the login bug");
    expect(p).toContain("2. deploy to staging");
    expect(p).toMatch(/JSON array/i);
  });
});

describe("parseLabels", () => {
  it("parses a plain JSON array", () => {
    expect(parseLabels('["Login Fix","Staging Deploy"]', 2)).toEqual(["Login Fix", "Staging Deploy"]);
  });
  it("strips ```json fences", () => {
    expect(parseLabels('```json\n["A","B"]\n```', 2)).toEqual(["A", "B"]);
  });
  it("pads with empty strings when the model returns too few", () => {
    expect(parseLabels('["only one"]', 3)).toEqual(["only one", "", ""]);
  });
  it("truncates when the model returns too many", () => {
    expect(parseLabels('["a","b","c"]', 2)).toEqual(["a", "b"]);
  });
  it("returns all-empty on unparseable output", () => {
    expect(parseLabels("not json at all", 2)).toEqual(["", ""]);
  });
});

describe("labelSegments", () => {
  it("runs the injected runner and returns labels + cost", () => {
    const run = (_prompt: string) => ({ result: '["Auth Fix","Deploy"]', costUsd: 0.03 });
    const out = labelSegments([seg(0, "x"), seg(1, "y")], { run });
    expect(out.labels).toEqual(["Auth Fix", "Deploy"]);
    expect(out.costUsd).toBe(0.03);
  });
  it("returns empty labels for no segments without calling the runner", () => {
    let called = false;
    const out = labelSegments([], { run: () => { called = true; return { result: "[]", costUsd: 0 }; } });
    expect(out.labels).toEqual([]);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/labeling.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/labeling/label-segments.ts
import { execFileSync } from "node:child_process";
import type { Segment } from "../lib/segment.js";

export type LabelRun = (prompt: string) => { result: string; costUsd: number };

export function buildLabelPrompt(segments: Segment[]): string {
  const list = segments.map((s, i) => `${i + 1}. ${s.opener.replace(/\s+/g, " ").slice(0, 220)}`).join("\n");
  return (
    "You are labeling segments of a developer's Claude Code session. Each numbered item is the " +
    "opening user message of a distinct work-segment. Give each a concise 3-5 word topic label in " +
    "Title Case, no trailing punctuation. Output ONLY a JSON array of strings, one label per segment, " +
    "in the same order.\n\n" +
    list
  );
}

export function parseLabels(resultText: string, expected: number): string[] {
  let arr: unknown = null;
  const cleaned = resultText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { arr = JSON.parse(cleaned); } catch { arr = null; }
  const labels = Array.isArray(arr) ? arr.map((x) => (typeof x === "string" ? x.trim() : "")) : [];
  const out = labels.slice(0, expected);
  while (out.length < expected) out.push("");
  return out;
}

export const defaultLabelRun: LabelRun = (prompt) => {
  const raw = execFileSync(
    "claude",
    ["-p", prompt, "--model", "haiku", "--output-format", "json"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 180_000 }
  );
  const o = JSON.parse(raw) as { result?: string; total_cost_usd?: number; is_error?: boolean };
  if (o.is_error) throw new Error("claude -p returned an error");
  return { result: o.result ?? "[]", costUsd: o.total_cost_usd ?? 0 };
};

export function labelSegments(
  segments: Segment[],
  opts: { run?: LabelRun } = {}
): { labels: string[]; costUsd: number } {
  if (segments.length === 0) return { labels: [], costUsd: 0 };
  const run = opts.run ?? defaultLabelRun;
  const { result, costUsd } = run(buildLabelPrompt(segments));
  return { labels: parseLabels(result, segments.length), costUsd };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/labeling.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/labeling/label-segments.ts tests/labeling.test.ts
git commit -m "feat(labeling): batched claude -p segment labeler (injectable runner)"
```

---

## Task 2: `segment_labels` table + db module

**Files:**
- Modify: `src/db/init.ts`
- Create: `src/db/labels.ts`
- Test: `tests/labels-db.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/labels-db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { spineHash, getLabels, saveLabels } from "../src/db/labels.js";
import type { Segment } from "../src/lib/segment.js";

function seg(index: number, opener: string): Segment {
  return { index, startLine: index * 2, startedAt: 0, endedAt: 0, turnCount: 1, opener, reason: "gap", gapMinutes: 30 };
}

describe("spineHash", () => {
  it("is stable for the same segments and changes when an opener changes", () => {
    const a = [seg(0, "x"), seg(1, "y")];
    expect(spineHash(a)).toBe(spineHash([seg(0, "x"), seg(1, "y")]));
    expect(spineHash(a)).not.toBe(spineHash([seg(0, "x"), seg(1, "z")]));
  });
});

describe("db/labels", () => {
  let tmp: string, dbp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-lab-")); dbp = join(tmp, "t.db"); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("round-trips labels keyed on session + spine hash", () => {
    const db = openDb(dbp);
    saveLabels(db, { sessionId: "s1", spineHash: "h1", labels: ["A", "B"], model: "haiku", costUsd: 0.03 });
    const got = getLabels(db, "s1");
    expect(got).toEqual({ spineHash: "h1", labels: ["A", "B"] });
  });

  it("overwrites on re-save (one row per session)", () => {
    const db = openDb(dbp);
    saveLabels(db, { sessionId: "s1", spineHash: "h1", labels: ["A"], model: "haiku", costUsd: 0 });
    saveLabels(db, { sessionId: "s1", spineHash: "h2", labels: ["B", "C"], model: "haiku", costUsd: 0 });
    expect(getLabels(db, "s1")).toEqual({ spineHash: "h2", labels: ["B", "C"] });
  });

  it("returns null when none stored", () => {
    expect(getLabels(openDb(dbp), "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/labels-db.test.ts`
Expected: FAIL — module/table missing.

- [ ] **Step 3a: Add the table to `src/db/init.ts`**

Inside the `SCHEMA` template string, append before the closing backtick:

```sql
-- Layer 2a: AI-generated names for a session's segments. One row per session,
-- pinned to a spine hash so we only re-label when the segmentation changes.
CREATE TABLE IF NOT EXISTS segment_labels (
  session_id  TEXT PRIMARY KEY,
  spine_hash  TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  model       TEXT,
  cost_usd    REAL,
  created_at  INTEGER NOT NULL
);
```

- [ ] **Step 3b: Create `src/db/labels.ts`**

```typescript
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { Segment } from "../lib/segment.js";

/** Stable signature of a session's segmentation — changes only if a segment's
 *  start line or opener changes, so cached labels invalidate exactly then. */
export function spineHash(segments: Segment[]): string {
  const basis = JSON.stringify(segments.map((s) => [s.startLine, s.opener]));
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export type SaveLabelsInput = {
  sessionId: string;
  spineHash: string;
  labels: string[];
  model: string;
  costUsd: number;
};

export function saveLabels(db: Database.Database, rec: SaveLabelsInput): void {
  db.prepare(
    `INSERT INTO segment_labels (session_id, spine_hash, labels_json, model, cost_usd, created_at)
     VALUES (@sessionId, @spineHash, @labelsJson, @model, @costUsd, @createdAt)
     ON CONFLICT(session_id) DO UPDATE SET
       spine_hash  = excluded.spine_hash,
       labels_json = excluded.labels_json,
       model       = excluded.model,
       cost_usd    = excluded.cost_usd,
       created_at  = excluded.created_at`
  ).run({
    sessionId: rec.sessionId,
    spineHash: rec.spineHash,
    labelsJson: JSON.stringify(rec.labels),
    model: rec.model,
    costUsd: rec.costUsd,
    createdAt: Date.now(),
  });
}

export function getLabels(
  db: Database.Database,
  sessionId: string
): { spineHash: string; labels: string[] } | null {
  const row = db
    .prepare("SELECT spine_hash AS spineHash, labels_json AS labelsJson FROM segment_labels WHERE session_id = ?")
    .get(sessionId) as { spineHash: string; labelsJson: string } | undefined;
  if (!row) return null;
  let labels: string[] = [];
  try { labels = JSON.parse(row.labelsJson); } catch { labels = []; }
  return { spineHash: row.spineHash, labels };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/labels-db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/init.ts src/db/labels.ts tests/labels-db.test.ts
git commit -m "feat(db): segment_labels table + spine-hash-keyed label cache"
```

---

## Task 3: `/api/label` route

**Files:**
- Create: `src/pages/api/label.ts`

- [ ] **Step 1: Create the route**

```typescript
import type { APIRoute } from "astro";
import { openDb } from "../../db/init.js";
import { getSessionMessages } from "../../db/messages.js";
import { segmentSession } from "../../lib/segment.js";
import { labelSegments } from "../../labeling/label-segments.js";
import { spineHash, getLabels, saveLabels } from "../../db/labels.js";
import { INDEX_DB_PATH } from "../../paths.js";

/**
 * Name a session's segments with Claude. Same-origin JSON POST. Cached by spine
 * hash — returns instantly if already labeled for the current segmentation;
 * otherwise runs one `claude -p` (Haiku) call (~60s) and persists the result.
 */
export const POST: APIRoute = async ({ request }) => {
  let sessionId = "";
  try {
    const body = (await request.json()) as { sessionId?: string };
    sessionId = String(body.sessionId ?? "").trim();
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), { status: 400 });
  }
  if (!sessionId) return new Response(JSON.stringify({ error: "missing sessionId" }), { status: 400 });

  const db = openDb(INDEX_DB_PATH);
  const segments = segmentSession(getSessionMessages(db, sessionId));
  if (segments.length === 0) {
    db.close();
    return new Response(JSON.stringify({ labels: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const hash = spineHash(segments);
  const cached = getLabels(db, sessionId);
  if (cached && cached.spineHash === hash) {
    db.close();
    return new Response(JSON.stringify({ labels: cached.labels, cached: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { labels, costUsd } = labelSegments(segments);
    saveLabels(db, { sessionId, spineHash: hash, labels, model: "haiku", costUsd });
    db.close();
    return new Response(JSON.stringify({ labels, costUsd, cached: false }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    db.close();
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/label.ts
git commit -m "feat(api): /api/label — cached claude segment naming endpoint"
```

---

## Task 4: reader — show AI labels + "Name threads" button

**Files:**
- Modify: `src/components/SessionReader.astro`

- [ ] **Step 1: Load cached labels in the frontmatter**

After the line `const segByStartLine = new Map(...)` (added in Layer 1), add:

```astro
import { getLabels, spineHash } from "../db/labels";
```
(add the import at the top with the other imports), and in the frontmatter, after `db` is opened and BEFORE `db.close()`, capture labels:

```astro
const cachedLabels = getLabels(db, sessionId);
const labelsFresh = cachedLabels && cachedLabels.spineHash === spineHash(segments);
const segLabel = (i: number): string | null => (labelsFresh ? cachedLabels!.labels[i] ?? null : null);
```

> Note: `segments` is computed before `db.close()`. Ensure `getLabels`/`spineHash` run before the existing `db.close()`. Move the `segmentSession` + these label lines above `db.close()` if needed.

- [ ] **Step 2: Use the label in the divider and nav (fallback to opener)**

In the segment divider (Layer 1), change the `.seg-label` span to prefer the AI label:

```astro
<span class="seg-label">{segLabel(segByStartLine.get(b.lineNo)!.index) ?? segByStartLine.get(b.lineNo)!.opener}</span>
```

In the `seg-nav` items, change `.seg-nav-text` similarly and add a ✨ when AI-labeled:

```astro
<span class="seg-nav-text">{segLabel(s.index) ? `✨ ${segLabel(s.index)}` : s.opener}</span>
```

- [ ] **Step 3: Add the "Name threads" button to the nav header**

Replace the `seg-nav-head` line:

```astro
        <div class="seg-nav-head">{segments.length} threads</div>
```
with a header that includes the button (only shown when labels are missing/stale):

```astro
        <div class="seg-nav-head">
          {segments.length} threads
          {!labelsFresh && (
            <button id="name-threads" class="name-btn" data-session={sessionId}>✨ Name</button>
          )}
        </div>
```

- [ ] **Step 4: Add the button styles + click script**

In the `<style>` block append:

```css
  .name-btn { float:right; background:var(--raise); color:var(--amber-bright); border:1px solid var(--border); border-radius:6px; font-size:10.5px; padding:2px 7px; cursor:pointer; }
  .name-btn[disabled] { opacity:.6; cursor:progress; }
```

Add an inline script (near the existing resume script):

```astro
<script is:inline>
  (function () {
    var btn = document.getElementById("name-threads");
    if (!btn) return;
    btn.addEventListener("click", async function () {
      btn.disabled = true; btn.textContent = "✨ Naming…";
      try {
        var res = await fetch("/api/label", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: btn.dataset.session }),
        });
        if (res.ok) location.reload();
        else { btn.disabled = false; btn.textContent = "✨ Name"; }
      } catch (e) { btn.disabled = false; btn.textContent = "✨ Name"; }
    });
  })();
</script>
```

- [ ] **Step 5: Typecheck + build**

Run: `npx astro check && npm run build:web`
Expected: 0 errors; "Complete!".

- [ ] **Step 6: Commit**

```bash
git add src/components/SessionReader.astro
git commit -m "feat(reader): AI thread names with on-demand 'Name threads' button"
```

---

## Task 5: full verification

**Files:** none

- [ ] **Step 1: Tests + typecheck**

Run: `npx vitest run && npx tsc --noEmit && npx astro check`
Expected: all pass; tsc 0; astro 0 errors.

- [ ] **Step 2: Live test the naming flow**

```bash
npm run build && npm run build:web
PORT=4399 HOST=127.0.0.1 node ./dist-web/server/entry.mjs &
# POST /api/label for a real multi-segment session, confirm labels return + cache hit on 2nd call
curl -s -X POST http://127.0.0.1:4399/api/label -H "Content-Type: application/json" \
  -d '{"sessionId":"f463c063-9cbd-42f0-89a7-ce72e8a00c69"}' | head -c 400
```
Then drive the playwright-skill to open the session, confirm the nav shows the ✨ labels after naming (or that cached labels render on load). Stop the server.

- [ ] **Step 3: Commit any tweaks**

```bash
git add -A && git commit -m "chore(reader): thread-naming visual polish from review"
```

---

## Self-Review

- **Spec coverage (2a):** batched one-call-per-session naming ✓ (Task 1); Haiku + json ✓ (default runner); cached by spine hash ✓ (Task 2); on-demand, never auto/blocking-all ✓ (button + API); labels marked ✨ and only annotate (boundaries untouched) ✓ (Task 4); pinned/invalidate-on-spine-change ✓ (`labelsFresh`). Deferred per spec: 2b immediate-pivot, 2c cross-session graph, batch CLI.
- **Placeholders:** none — full code each step.
- **Type consistency:** `Segment` reused from `src/lib/segment.ts`; `LabelRun`, `SaveLabelsInput`, `getLabels` return `{spineHash, labels}`, `spineHash(segments)`, `labelSegments(segments,{run})` consistent across Tasks 1–4. `labels_json` column ↔ `labelsJson` param mapping matches.
- **Note:** `/api/label` is a same-origin JSON POST (CSRF-safe, like `/api/exclusions`). The ~60s call holds the request open; the client shows a "Naming…" state.
