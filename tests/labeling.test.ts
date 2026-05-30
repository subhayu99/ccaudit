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
