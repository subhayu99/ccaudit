import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walkProjects } from "../src/indexer/walk.js";
import { parseJsonlFile } from "../src/indexer/parse.js";

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

describe("indexer/parse", () => {
  it("yields one parsed RawMessage per valid line, with 1-based lineNo", async () => {
    const fixture = "tests/fixtures/projects/basic/session-aaa.jsonl";
    const out: Array<{ lineNo: number; raw: unknown; rawJson: string }> = [];
    for await (const item of parseJsonlFile(fixture)) {
      out.push(item);
    }
    expect(out).toHaveLength(2);
    expect(out[0]!.lineNo).toBe(1);
    expect(out[1]!.lineNo).toBe(2);
    expect((out[0]!.raw as any).type).toBe("user");
    expect(out[0]!.rawJson).toContain('"hello"');
  });

  it("skips malformed lines and reports them via the onError callback", async () => {
    const fixture = "tests/fixtures/projects/malformed/session-ddd.jsonl";
    const errors: Array<{ lineNo: number; line: string }> = [];
    const out = [];
    for await (const item of parseJsonlFile(fixture, { onError: (e) => errors.push(e) })) {
      out.push(item);
    }
    expect(out).toHaveLength(2);          // lines 1 and 3
    expect(out.map((o) => o.lineNo)).toEqual([1, 3]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.lineNo).toBe(2);
  });
});
