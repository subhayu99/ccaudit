import { describe, it, expect } from "vitest";
import { newAggregator } from "../src/indexer/aggregate.js";
import type { RawMessage } from "../src/types.js";

function feed(lines: RawMessage[]) {
  const agg = newAggregator();
  lines.forEach((raw, i) => agg.observe({ lineNo: i + 1, raw, rawJson: JSON.stringify(raw) }));
  return agg.state;
}

const asst = (model: string, u: Partial<{ i: number; o: number; cr: number; cc: number }>): RawMessage => ({
  type: "assistant",
  message: {
    role: "assistant",
    model,
    usage: {
      input_tokens: u.i ?? 0,
      output_tokens: u.o ?? 0,
      cache_read_input_tokens: u.cr ?? 0,
      cache_creation_input_tokens: u.cc ?? 0,
    },
  },
});

describe("aggregate: token usage", () => {
  it("sums per-model token usage across messages", () => {
    const s = feed([
      asst("claude-opus-4-7", { i: 10, o: 5, cr: 100, cc: 20 }),
      asst("claude-opus-4-7", { i: 4, o: 1 }),
      asst("claude-haiku-4-5", { i: 1000, o: 2000 }),
    ]);
    expect(s.tokenUsage["claude-opus-4-7"]).toEqual({ input: 14, output: 6, cacheRead: 100, cacheCreation: 20 });
    expect(s.tokenUsage["claude-haiku-4-5"]).toEqual({ input: 1000, output: 2000, cacheRead: 0, cacheCreation: 0 });
  });

  it("ignores synthetic and usage-less messages", () => {
    const s = feed([
      asst("<synthetic>", { i: 999 }),
      { type: "user", message: { role: "user", content: "hi" } },
    ]);
    expect(Object.keys(s.tokenUsage)).toHaveLength(0);
  });
});
