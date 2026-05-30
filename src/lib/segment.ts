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
