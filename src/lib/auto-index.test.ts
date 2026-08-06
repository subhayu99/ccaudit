import { describe, it, expect } from "vitest";
import { shouldAutoIndex, makePeriodicIndexer } from "./auto-index";

describe("shouldAutoIndex", () => {
  it("skips when the parent already pre-indexed (CCAUDIT_PREINDEXED=1)", () => {
    expect(shouldAutoIndex({ CCAUDIT_PREINDEXED: "1" })).toBe(false);
  });
  it("indexes otherwise (dev mode / astro dev with no supervisor)", () => {
    expect(shouldAutoIndex({})).toBe(true);
    expect(shouldAutoIndex({ CCAUDIT_PREINDEXED: "0" })).toBe(true);
  });
});

describe("makePeriodicIndexer", () => {
  it("never runs overlapping passes even if a pass is slower than the interval", async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const runIndex = () =>
      new Promise<void>((res) => {
        runs++;
        active++;
        maxActive = Math.max(maxActive, active);
        setTimeout(() => {
          active--;
          res();
        }, 50);
      });
    const p = makePeriodicIndexer(runIndex, { intervalMs: 10 });
    p.start();
    await new Promise((r) => setTimeout(r, 130));
    p.stop();
    expect(maxActive).toBe(1);
    expect(runs).toBeGreaterThan(0);
  });

  it("stop() prevents any further passes", async () => {
    let runs = 0;
    const p = makePeriodicIndexer(async () => {
      runs++;
    }, { intervalMs: 10 });
    p.start();
    await new Promise((r) => setTimeout(r, 35));
    p.stop();
    const settled = runs;
    await new Promise((r) => setTimeout(r, 40));
    expect(runs).toBe(settled);
  });

  it("a throwing pass does not stop the schedule", async () => {
    let runs = 0;
    const p = makePeriodicIndexer(async () => {
      runs++;
      throw new Error("transient");
    }, { intervalMs: 10 });
    p.start();
    await new Promise((r) => setTimeout(r, 45));
    p.stop();
    expect(runs).toBeGreaterThan(1);
  });
});
