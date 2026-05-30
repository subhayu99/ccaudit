import { describe, expect, it } from "vitest";
import { clampLimit } from "./limit.js";

describe("clampLimit", () => {
  it("returns a valid positive integer unchanged", () => {
    expect(clampLimit(50, 30)).toBe(50);
  });

  it("falls back to the default for non-numeric input", () => {
    expect(clampLimit("abc", 30)).toBe(30);
  });

  it("falls back to the default for negative input", () => {
    expect(clampLimit(-5, 30)).toBe(30);
  });

  it("falls back to the default for zero", () => {
    expect(clampLimit(0, 30)).toBe(30);
  });

  it("caps huge values at 1000", () => {
    expect(clampLimit(99999, 30)).toBe(1000);
  });

  it("truncates fractional values toward zero", () => {
    expect(clampLimit(10.7, 30)).toBe(10);
  });

  it("falls back to the default for undefined", () => {
    expect(clampLimit(undefined, 30)).toBe(30);
  });
});
