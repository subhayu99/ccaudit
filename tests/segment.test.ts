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

  it("uses the first non-empty turn as the opener when the segment opens with boilerplate", () => {
    const segs = segmentSession([
      user(0, 0, "/tmp/attachments/pasted.txt"), // cleans to empty
      user(2, 5, "the real ask"),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.opener).toBe("the real ask");
  });
});
