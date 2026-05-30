import { describe, it, expect } from "vitest";
import { classifyExecError, parseClaudeJson, runClaude } from "../src/labeling/run-claude.js";

describe("classifyExecError", () => {
  it("maps ENOENT to a 'not found on PATH' message", () => {
    const e = classifyExecError({ code: "ENOENT" });
    expect(e.message).toMatch(/not found on PATH/i);
    expect(e.message).toMatch(/install Claude Code/i);
  });

  it("maps a killed/timeout error to a recognizable timeout error", () => {
    const e = classifyExecError({ killed: true, signal: "SIGTERM" });
    expect(e.message).toMatch(/^claude -p timed out/);
    expect((e as { isTimeout?: boolean }).isTimeout).toBe(true);
  });

  it("also treats ETIMEDOUT code as a timeout", () => {
    const e = classifyExecError({ code: "ETIMEDOUT" });
    expect(e.message).toMatch(/^claude -p timed out/);
    expect((e as { isTimeout?: boolean }).isTimeout).toBe(true);
  });

  it("includes trimmed stderr for a non-zero exit", () => {
    const e = classifyExecError({ code: 2, stderr: "  boom: bad flag  \n" });
    expect(e.message).toMatch(/boom: bad flag/);
    expect(e.message).not.toMatch(/^\s/);
  });

  it("falls back to the original message when nothing else matches", () => {
    const e = classifyExecError({ message: "weird failure" });
    expect(e.message).toMatch(/weird failure/);
  });
});

describe("parseClaudeJson", () => {
  it("parses a valid claude -p JSON envelope", () => {
    const o = parseClaudeJson('{"result":"[\\"A\\"]","total_cost_usd":0.02}');
    expect(o.result).toBe('["A"]');
    expect(o.total_cost_usd).toBe(0.02);
  });

  it("throws a 'did not return JSON' error on non-JSON, including a snippet", () => {
    expect(() => parseClaudeJson("totally not json")).toThrow(/did not return JSON/);
    expect(() => parseClaudeJson("totally not json")).toThrow(/totally not json/);
  });

  it("truncates the snippet to 200 chars", () => {
    const big = "x".repeat(500);
    let msg = "";
    try { parseClaudeJson(big); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("x".repeat(200));
    expect(msg).not.toContain("x".repeat(201));
  });
});

describe("runClaude (injected execFile)", () => {
  it("returns stdout on success", async () => {
    const fakeExec = ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: "hello\n", stderr: "" });
    }) as unknown as typeof import("node:child_process").execFile;
    const out = await runClaude(["-p", "hi"], { execFileImpl: fakeExec });
    expect(out).toBe("hello\n");
  });

  it("classifies ENOENT", async () => {
    const fakeExec = ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const err = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
      cb(err, { stdout: "", stderr: "" });
    }) as unknown as typeof import("node:child_process").execFile;
    await expect(runClaude(["-p", "hi"], { execFileImpl: fakeExec })).rejects.toThrow(/not found on PATH/i);
  });

  it("classifies timeout (killed)", async () => {
    const fakeExec = ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const err = Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" });
      cb(err, { stdout: "", stderr: "" });
    }) as unknown as typeof import("node:child_process").execFile;
    await expect(runClaude(["-p", "hi"], { execFileImpl: fakeExec })).rejects.toThrow(/^claude -p timed out/);
  });

  it("classifies non-zero exit with stderr", async () => {
    const fakeExec = ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const err = Object.assign(new Error("exit"), { code: 1, stderr: "kaboom" });
      cb(err, { stdout: "", stderr: "kaboom" });
    }) as unknown as typeof import("node:child_process").execFile;
    await expect(runClaude(["-p", "hi"], { execFileImpl: fakeExec })).rejects.toThrow(/kaboom/);
  });
});
