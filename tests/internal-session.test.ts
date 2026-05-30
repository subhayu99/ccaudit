import { describe, it, expect } from "vitest";
import { isInternalToolPrompt } from "../src/lib/internal-session.js";
import { newAggregator } from "../src/indexer/aggregate.js";
import type { RawMessage } from "../src/types.js";

describe("isInternalToolPrompt", () => {
  it("flags the name-sessions prompt", () => {
    expect(isInternalToolPrompt("You are titling 20 of a developer's Claude Code sessions for a history browser.")).toBe(true);
  });
  it("flags the label-segments prompt", () => {
    expect(isInternalToolPrompt("You are labeling segments of a developer's Claude Code session. Each numbered item…")).toBe(true);
  });
  it("flags the cluster prompt (even behind a long preamble)", () => {
    const preamble = "You may assign to these existing topics: " + "Topic, ".repeat(40);
    expect(isInternalToolPrompt(preamble + "Below are 13 NEW developer coding-session titles. Assign each…")).toBe(true);
  });
  it("does NOT flag a normal user message", () => {
    expect(isInternalToolPrompt("help me title my sessions and label the segments of my code")).toBe(false);
    expect(isInternalToolPrompt(null)).toBe(false);
    expect(isInternalToolPrompt("")).toBe(false);
  });
});

describe("aggregate marks internal sessions", () => {
  function feed(lines: RawMessage[]) {
    const agg = newAggregator();
    lines.forEach((raw, i) => agg.observe({ lineNo: i + 1, raw, rawJson: JSON.stringify(raw) }));
    return agg.state;
  }
  it("sets isInternal from the first user message", () => {
    const s = feed([{ type: "user", message: { role: "user", content: "You are titling 5 of a developer's Claude Code sessions for a history browser." } }]);
    expect(s.isInternal).toBe(true);
  });
  it("leaves isInternal false for a real session", () => {
    const s = feed([{ type: "user", message: { role: "user", content: "fix the failing build" } }]);
    expect(s.isInternal).toBe(false);
  });
});
