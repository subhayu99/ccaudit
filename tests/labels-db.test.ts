import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { spineHash, getLabels, saveLabels } from "../src/db/labels.js";
import type { Segment } from "../src/lib/segment.js";

function seg(index: number, opener: string): Segment {
  return { index, startLine: index * 2, startedAt: 0, endedAt: 0, turnCount: 1, opener, reason: "gap", gapMinutes: 30 };
}

describe("spineHash", () => {
  it("is stable for the same segments and changes when an opener changes", () => {
    const a = [seg(0, "x"), seg(1, "y")];
    expect(spineHash(a)).toBe(spineHash([seg(0, "x"), seg(1, "y")]));
    expect(spineHash(a)).not.toBe(spineHash([seg(0, "x"), seg(1, "z")]));
  });
});

describe("db/labels", () => {
  let tmp: string, dbp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-lab-")); dbp = join(tmp, "t.db"); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("round-trips labels keyed on session + spine hash", () => {
    const db = openDb(dbp);
    saveLabels(db, { sessionId: "s1", spineHash: "h1", labels: ["A", "B"], model: "haiku", costUsd: 0.03 });
    const got = getLabels(db, "s1");
    expect(got).toEqual({ spineHash: "h1", labels: ["A", "B"] });
  });

  it("overwrites on re-save (one row per session)", () => {
    const db = openDb(dbp);
    saveLabels(db, { sessionId: "s1", spineHash: "h1", labels: ["A"], model: "haiku", costUsd: 0 });
    saveLabels(db, { sessionId: "s1", spineHash: "h2", labels: ["B", "C"], model: "haiku", costUsd: 0 });
    expect(getLabels(db, "s1")).toEqual({ spineHash: "h2", labels: ["B", "C"] });
  });

  it("returns null when none stored", () => {
    expect(getLabels(openDb(dbp), "nope")).toBeNull();
  });
});
