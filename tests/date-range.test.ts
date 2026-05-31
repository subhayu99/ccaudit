import { describe, it, expect } from "vitest";
import { resolveRange, rangeCondition, rangeLabel } from "../src/db/date-range.js";

const DAY = 86_400_000;
const NOW = new Date(2026, 4, 31, 12, 0, 0).getTime();

describe("resolveRange", () => {
  it("returns null for all-time (undefined / empty / 'all')", () => {
    expect(resolveRange(undefined, NOW)).toBeNull();
    expect(resolveRange("", NOW)).toBeNull();
    expect(resolveRange("all", NOW)).toBeNull();
  });
  it("resolves day presets relative to now", () => {
    expect(resolveRange("7d", NOW)).toEqual({ from: NOW - 7 * DAY, to: NOW });
    expect(resolveRange("30d", NOW)).toEqual({ from: NOW - 30 * DAY, to: NOW });
    expect(resolveRange("90d", NOW)).toEqual({ from: NOW - 90 * DAY, to: NOW });
  });
  it("resolves a custom:from:to token", () => {
    const f = new Date(2026, 0, 1).getTime(), t = new Date(2026, 2, 1).getTime();
    expect(resolveRange(`custom:${f}:${t}`, NOW)).toEqual({ from: f, to: t });
  });
  it("returns null for malformed / inverted custom tokens", () => {
    expect(resolveRange("custom:abc:def", NOW)).toBeNull();
    expect(resolveRange("custom:200:100", NOW)).toBeNull(); // to < from
    expect(resolveRange("weird", NOW)).toBeNull();
  });
});

describe("rangeCondition", () => {
  it("is the always-true sentinel when no range", () => {
    expect(rangeCondition(null)).toEqual({ sql: "1", params: {} });
  });
  it("builds a BETWEEN-style clause with named params on the given column", () => {
    const c = rangeCondition({ from: 100, to: 200 }, "last_activity");
    expect(c.sql).toBe("(last_activity >= @rgFrom AND last_activity <= @rgTo)");
    expect(c.params).toEqual({ rgFrom: 100, rgTo: 200 });
  });
});

describe("rangeLabel", () => {
  it("labels presets and all-time", () => {
    expect(rangeLabel("all")).toBe("All time");
    expect(rangeLabel(undefined)).toBe("All time");
    expect(rangeLabel("7d")).toBe("Last 7 days");
    expect(rangeLabel("30d")).toBe("Last 30 days");
    expect(rangeLabel("90d")).toBe("Last 90 days");
  });
});
