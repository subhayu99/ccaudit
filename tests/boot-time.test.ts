import { describe, it, expect } from "vitest";
import { parseDarwinBoottimeSec } from "../src/lib/boot-time.js";

describe("parseDarwinBoottimeSec", () => {
  it("extracts the sec field from `sysctl -n kern.boottime` output", () => {
    const out = "{ sec = 1780001577, usec = 0 } Thu May 28 20:52:57 2026\n";
    expect(parseDarwinBoottimeSec(out)).toBe(1780001577);
  });
  it("tolerates extra whitespace around the equals sign", () => {
    expect(parseDarwinBoottimeSec("{ sec=42, usec=0 }")).toBe(42);
  });
  it("returns null when there is no sec field", () => {
    expect(parseDarwinBoottimeSec("garbage")).toBeNull();
  });
});
