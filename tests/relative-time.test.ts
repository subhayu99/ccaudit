import { describe, it, expect } from "vitest";
import { relativeTime } from "../src/lib/render.js";

const SEC = 1000, MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;
// Fixed "now": Sun May 31 2026, 12:00 local.
const NOW = new Date(2026, 4, 31, 12, 0, 0).getTime();
const ago = (ms: number) => NOW - ms;
const at = (...a: [number, number, number, number?, number?]) => new Date(...a).getTime();

describe("relativeTime", () => {
  it("returns an em dash for null", () => {
    expect(relativeTime(null, NOW)).toBe("—");
  });
  it("says 'just now' under a minute", () => {
    expect(relativeTime(ago(0), NOW)).toBe("just now");
    expect(relativeTime(ago(30 * SEC), NOW)).toBe("just now");
  });
  it("shows minutes under an hour", () => {
    expect(relativeTime(ago(5 * MIN), NOW)).toBe("5m ago");
    expect(relativeTime(ago(59 * MIN), NOW)).toBe("59m ago");
  });
  it("shows hours under a day (covers 'today' and into yesterday)", () => {
    expect(relativeTime(ago(90 * MIN), NOW)).toBe("1h ago");
    expect(relativeTime(ago(5 * HR), NOW)).toBe("5h ago");
    expect(relativeTime(ago(23 * HR), NOW)).toBe("23h ago");
  });
  it("shows days under a week", () => {
    expect(relativeTime(ago(25 * HR), NOW)).toBe("1d ago");
    expect(relativeTime(ago(3 * DAY), NOW)).toBe("3d ago");
    expect(relativeTime(ago(6 * DAY + 23 * HR), NOW)).toBe("6d ago");
  });
  it("switches to a short date at the 7-day threshold", () => {
    expect(relativeTime(at(2026, 4, 24, 12, 0), NOW)).toBe("May 24"); // exactly 7 days
    expect(relativeTime(at(2026, 4, 23, 12, 0), NOW)).toBe("May 23");
  });
  it("includes the year for a different year", () => {
    expect(relativeTime(at(2025, 11, 25, 12, 0), NOW)).toBe("Dec 25, 2025");
  });
  it("clamps future timestamps to 'just now'", () => {
    expect(relativeTime(NOW + HR, NOW)).toBe("just now");
  });
});
