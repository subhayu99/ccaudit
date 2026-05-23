import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walkProjects } from "../src/indexer/walk.js";

describe("indexer/walk", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-walk-"));
    mkdirSync(join(tmp, "-Users-x-proj"));
    mkdirSync(join(tmp, "-Users-y-other"));
    writeFileSync(join(tmp, "-Users-x-proj", "sess-1.jsonl"), "{}\n");
    writeFileSync(join(tmp, "-Users-y-other", "sess-2.jsonl"), "{}\n");
    writeFileSync(join(tmp, "-Users-x-proj", "notes.txt"), "ignore me");
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("returns one entry per .jsonl file with project metadata", () => {
    const entries = walkProjects(tmp);
    const sorted = entries.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    expect(sorted).toHaveLength(2);
    expect(sorted[0]!.sessionId).toBe("sess-1");
    expect(sorted[0]!.projectDir).toBe("/Users/x/proj");
    expect(sorted[0]!.projectLabel).toBe("x/proj");
    expect(sorted[0]!.filePath).toContain("sess-1.jsonl");
    expect(sorted[0]!.fileSize).toBeGreaterThan(0);
    expect(sorted[0]!.fileMtime).toBeGreaterThan(0);
  });

  it("ignores non-.jsonl files", () => {
    const entries = walkProjects(tmp);
    expect(entries.every((e) => e.filePath.endsWith(".jsonl"))).toBe(true);
  });

  it("returns empty array if base dir does not exist", () => {
    expect(walkProjects(join(tmp, "nope"))).toEqual([]);
  });
});
