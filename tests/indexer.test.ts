import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walkProjects } from "../src/indexer/walk.js";
import { parseJsonlFile } from "../src/indexer/parse.js";
import { extractText } from "../src/indexer/extract.js";
import { newAggregator, finalizeAggregator } from "../src/indexer/aggregate.js";
import type { RawMessage } from "../src/types.js";

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

describe("indexer/extract", () => {
  it("extracts text for a user message", () => {
    const raw: RawMessage = { type: "user", message: { role: "user", content: "hello world" } };
    expect(extractText(raw)).toBe("hello world");
  });

  it("extracts text from an assistant content array", () => {
    const raw: RawMessage = {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "hi there" }] as unknown as unknown },
    };
    expect(extractText(raw)).toBe("hi there");
  });

  it("skips tool_use entries when extracting assistant text", () => {
    const raw: RawMessage = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Read", input: { path: "/x" } },
          { type: "text", text: "after the tool" },
        ] as unknown as unknown,
      },
    };
    expect(extractText(raw)).toBe("after the tool");
  });

  it("returns a marker for attachment messages", () => {
    const raw = { type: "attachment", attachment: { filename: "x.png" } } as unknown as RawMessage;
    expect(extractText(raw)).toBe("[attachment: x.png]");
  });

  it("truncates tool_result content to 2000 chars", () => {
    const big = "x".repeat(3000);
    const raw: RawMessage = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: [{ type: "text", text: big }] }] as unknown as unknown,
      },
    };
    expect(extractText(raw)!.length).toBeLessThanOrEqual(2000);
  });

  it("returns null for unknown structure", () => {
    expect(extractText({ type: "queue-operation" } as RawMessage)).toBeNull();
  });
});

describe("indexer/aggregate", () => {
  it("computes session aggregates from a fixture file", async () => {
    const agg = newAggregator();
    for await (const { lineNo, raw, rawJson } of parseJsonlFile("tests/fixtures/projects/compact/session-bbb.jsonl")) {
      agg.observe({ lineNo, raw, rawJson, sessionId: "bbb" });
    }
    const result = finalizeAggregator(agg);
    expect(result.messageCount).toBe(5);
    expect(result.userMsgCount).toBe(2);
    expect(result.compactCount).toBe(1);
    expect(result.firstPrompt).toBe("first prompt");
    expect(result.aiTitle).toBe("the AI title");
    expect(result.gitBranch).toBe("main");
    expect(result.startedAt).toBeGreaterThan(0);
    expect(result.lastActivity).toBeGreaterThanOrEqual(result.startedAt!);
    expect(result.messages).toHaveLength(5);
    expect(result.messages[3]!.isCompactSummary).toBe(true);
  });
});
