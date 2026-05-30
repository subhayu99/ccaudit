import { describe, it, expect } from "vitest";
import { newAggregator } from "../src/indexer/aggregate.js";
import type { RawMessage } from "../src/types.js";

function feed(lines: RawMessage[]) {
  const agg = newAggregator();
  lines.forEach((raw, i) => agg.observe({ lineNo: i + 1, raw, rawJson: JSON.stringify(raw) }));
  return agg.state;
}

describe("aggregate: title extraction", () => {
  it("reads the Claude Code session title from an `ai-title` line's `aiTitle` field", () => {
    const s = feed([
      { type: "user", message: { role: "user", content: "do the thing" } },
      { type: "ai-title", aiTitle: "Add More Modules To Project" },
    ]);
    expect(s.aiTitle).toBe("Add More Modules To Project");
  });

  it("prefers a user-set `custom-title` over the ai-title", () => {
    const s = feed([
      { type: "ai-title", aiTitle: "Generated Title" },
      { type: "custom-title", customTitle: "my-custom-name" },
    ]);
    // index-runner resolves precedence as customTitle ?? aiTitle; assert both captured.
    expect(s.aiTitle).toBe("Generated Title");
    expect(s.customTitle).toBe("my-custom-name");
  });

  it("falls back to the legacy `title` field on an ai-title line", () => {
    const s = feed([{ type: "ai-title", title: "Legacy Title" }]);
    expect(s.aiTitle).toBe("Legacy Title");
  });

  it("ignores blank/whitespace titles", () => {
    const s = feed([{ type: "ai-title", aiTitle: "   " }]);
    expect(s.aiTitle).toBeNull();
  });
});
