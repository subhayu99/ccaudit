import { describe, it, expect } from "vitest";
import { modelCostUsd, sessionCostUsd, totalTokens, primaryModel, formatUsd, hasUnpricedUsage } from "../src/lib/pricing.js";

describe("pricing", () => {
  it("computes opus cost from per-million rates", () => {
    // 1M input @15 + 1M output @75 = $90
    expect(modelCostUsd("claude-opus-4-7", { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0 })).toBeCloseTo(90, 6);
  });
  it("uses haiku rates for haiku models", () => {
    // 1M input @1 + 1M output @5 = $6
    expect(modelCostUsd("claude-haiku-4-5", { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0 })).toBeCloseTo(6, 6);
  });
  it("prices cache read and cache creation separately", () => {
    // sonnet: 1M cacheRead @0.3 + 1M cacheCreation @3.75 = 4.05
    expect(modelCostUsd("claude-sonnet-4-6", { input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 1_000_000 })).toBeCloseTo(4.05, 6);
  });
  it("does not price unknown models as Claude", () => {
    expect(modelCostUsd("mystery", { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 })).toBe(0);
  });
  it("sums cost across models in a session", () => {
    const usage = {
      "claude-opus-4-7": { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }, // $15
      "claude-haiku-4-5": { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }, // $1
    };
    expect(sessionCostUsd(usage)).toBeCloseTo(16, 6);
    expect(sessionCostUsd(null)).toBe(0);
  });
  it("totals tokens and picks the primary model", () => {
    const usage = {
      "claude-opus-4-7": { input: 100, output: 50, cacheRead: 10, cacheCreation: 5 }, // 165
      "claude-haiku-4-5": { input: 1000, output: 0, cacheRead: 0, cacheCreation: 0 }, // 1000
    };
    expect(totalTokens(usage)).toBe(1165);
    expect(primaryModel(usage)).toBe("claude-haiku-4-5");
  });
  it("formats USD by magnitude", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.5)).toBe("$0.500");
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatUsd(4567)).toBe("$4,567");
  });
});

it("prices Codex models with OpenAI rates and flags unavailable rates", () => {
  const u = { input: 1_000_000, cacheRead: 1_000_000, output: 1_000_000, cacheCreation: 0 };
  expect(modelCostUsd("gpt-5.3-codex", u)).toBeCloseTo(15.925);
  expect(modelCostUsd("gpt-6-sol", u)).toBeCloseTo(12.2);
  expect(modelCostUsd("gpt-5.4-2026-03-05", u)).toBeCloseTo(17.75);
  expect(hasUnpricedUsage({ "gpt-future": u })).toBe(true);
  expect(hasUnpricedUsage({ "codex-unknown": u })).toBe(true);
  expect(hasUnpricedUsage({ "gpt-5.3-codex": u })).toBe(false);
  expect(hasUnpricedUsage({ "gpt-5.3-codex": { ...u, cacheCreation: 100 } })).toBe(true);
});
