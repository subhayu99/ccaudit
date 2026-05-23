import { describe, it, expect } from "vitest";
import { formatTimestamp, truncate, shortSessionId } from "../src/lib/render.js";

describe("lib/render", () => {
  it("formatTimestamp returns a readable string", () => {
    // 2026-05-23T10:00:00Z in ms = 1779530400000
    expect(formatTimestamp(1779530400000)).toMatch(/2026-05-23 \d{2}:\d{2}/);
  });

  it("formatTimestamp returns em dash for null", () => {
    expect(formatTimestamp(null)).toBe("—");
  });

  it("truncate keeps short strings unchanged", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("truncate collapses whitespace and appends ellipsis when too long", () => {
    expect(truncate("a very\n\nlong   string here that won't fit", 12)).toBe("a very long…");
  });

  it("truncate returns '' for null/undefined", () => {
    expect(truncate(null, 10)).toBe("");
    expect(truncate(undefined, 10)).toBe("");
  });

  it("shortSessionId returns first 8 chars", () => {
    expect(shortSessionId("09a39a76-b1d4-4a22-9b9d-0b33175a09a3")).toBe("09a39a76");
  });
});
