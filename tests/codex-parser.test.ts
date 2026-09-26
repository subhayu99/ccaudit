import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCodexSession, walkCodexSessions } from "../src/indexer/codex.js";

const dirs: string[] = [];
function dir() { const p = mkdtempSync(join(tmpdir(), "ccaudit-codex-")); dirs.push(p); return p; }
function lines(path: string, data: unknown[]) { writeFileSync(path, data.map(x => typeof x === "string" ? x : JSON.stringify(x)).join("\n") + "\n"); }
afterEach(() => { for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true }); });

describe("Codex discovery", () => {
  it("discovers nested active and archive files from session_meta and prefers the first root for duplicate IDs", async () => {
    const active = dir(), archive = dir();
    const nested = join(active, "2026", "09", "26"); mkdirSync(nested, { recursive: true });
    const first = join(nested, "rollout-one.jsonl");
    lines(first, [{ type: "session_meta", timestamp: "2026-09-26T10:00:00Z", payload: { id: "native-1", cwd: "/work/repo", git: { branch: "main" } } }]);
    lines(join(archive, "duplicate.jsonl"), [{ type: "session_meta", payload: { id: "native-1", cwd: "/wrong" } }]);
    lines(join(archive, "second.jsonl"), [{ type: "session_meta", payload: { id: "native-2", cwd: "/other/project" } }]);
    symlinkSync(archive, join(active, "linked-archive"), "dir");
    const found = await walkCodexSessions([active, archive, join(active, "missing")]);
    expect(found.map(x => x.sessionId).sort()).toEqual(["codex:native-1", "codex:native-2"]);
    expect(found.find(x => x.sessionId === "codex:native-1")).toMatchObject({ provider: "codex", filePath: first, projectDir: "/work/repo", projectLabel: "work/repo" });
  });

  it("ignores JSONL without valid session metadata", async () => {
    const root = dir();
    lines(join(root, "wrong.jsonl"), [{ type: "response_item", payload: { type: "message", role: "user", content: [] } }]);
    expect(await walkCodexSessions([root])).toEqual([]);
  });
});

describe("Codex parsing", () => {
  it("maps text, tools, compact summaries and metadata while preserving physical lines", async () => {
    const root = dir(), file = join(root, "log.jsonl");
    const data = [
      { type: "session_meta", timestamp: "2026-09-26T10:00:00Z", payload: { id: "one", cwd: "/work/repo", git: { branch: "main" } } },
      "{malformed",
      { type: "response_item", timestamp: "2026-09-26T10:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "First prompt" }] } },
      { type: "event_msg", payload: { type: "user_message", message: "First prompt" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello" }] } },
      { type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: "{\"command\":\"pwd\"}", call_id: "call_1" } },
      { type: "response_item", payload: { type: "function_call_output", output: "ok", call_id: "call_1" } },
      { type: "response_item", payload: { type: "reasoning", encrypted_content: "private" } },
      { type: "event_msg", payload: { type: "agent_message", message: "Hello" } },
      { type: "event_msg", payload: { type: "compacted", message: "Earlier summary" } },
      { type: "turn_context", payload: { cwd: "/new/place", model: "gpt-5" } },
    ];
    lines(file, data);
    const errors: number[] = [];
    const state = await parseCodexSession(file, "codex:one", { onError: e => errors.push(e.lineNo) });
    expect(errors).toEqual([2]);
    expect(state.messages.map(x => [x.lineNo, x.type, x.textContent])).toEqual([
      [3, "user", "First prompt"], [5, "assistant", "Hello"],
      [6, "tool-use", expect.stringContaining("shell_command")],
      [7, "tool-result", "ok"], [10, "system", "Earlier summary"],
    ]);
    expect(state.messages[0]!.rawJson).toBe(JSON.stringify(data[2]));
    expect(state.messages[4]!.isCompactSummary).toBe(true);
    expect(state).toMatchObject({ messageCount: 5, userMsgCount: 1, compactCount: 1, firstPrompt: "First prompt", cwd: "/work/repo", gitBranch: "main" });
  });

  it("takes deltas from cumulative token snapshots without double-counting repeats", async () => {
    const root = dir(), file = join(root, "tokens.jsonl");
    const usage = (total: object, last?: object) => ({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last } } });
    lines(file, [
      { type: "turn_context", payload: { model: "gpt-5" } },
      usage({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 5 }),
      usage({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 5 }),
      usage({ input_tokens: 150, cached_input_tokens: 60, output_tokens: 35, reasoning_output_tokens: 10 }),
    ]);
    const state = await parseCodexSession(file, "codex:one");
    expect(state.tokenUsage["gpt-5"]).toEqual({ input: 90, output: 35, cacheRead: 60, cacheCreation: 0 });
  });

  it("uses last-token snapshots only when no cumulative snapshot exists", async () => {
    const root = dir(), file = join(root, "mixed-tokens.jsonl");
    lines(file, [
      { type: "turn_context", payload: { model: "gpt-5" } },
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 20, output_tokens: 5 } } } },
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 30, output_tokens: 25 } } } },
    ]);
    const state = await parseCodexSession(file, "codex:one");
    expect(state.tokenUsage["gpt-5"]).toEqual({ input: 70, output: 25, cacheRead: 30, cacheCreation: 0 });
  });

  it("attributes session-global cumulative deltas to the active model across switches", async () => {
    const root = dir(), file = join(root, "model-switch.jsonl");
    const total = (input_tokens: number) => ({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens, output_tokens: 0 } } } });
    lines(file, [
      { type: "turn_context", payload: { model: "gpt-a" } }, total(100),
      { type: "turn_context", payload: { model: "gpt-b" } }, total(150),
    ]);
    const state = await parseCodexSession(file, "codex:one");
    expect(state.tokenUsage["gpt-a"]?.input).toBe(100);
    expect(state.tokenUsage["gpt-b"]?.input).toBe(50);
  });

  it("counts outer compacted records even without summary text", async () => {
    const root = dir(), file = join(root, "compact.jsonl");
    lines(file, [{ type: "compacted", timestamp: "2026-09-26T10:00:00Z", payload: {} }]);
    const state = await parseCodexSession(file, "codex:one");
    expect(state.compactCount).toBe(1);
    expect(state.messages[0]).toMatchObject({ lineNo: 1, type: "system", isCompactSummary: true, textContent: null });
  });

  it("treats injected AGENTS and environment setup as system messages before the real prompt", async () => {
    const root = dir(), file = join(root, "setup.jsonl");
    const user = (text: string) => ({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    lines(file, [user("# AGENTS.md instructions\n<INSTRUCTIONS>setup</INSTRUCTIONS>"),
      { type: "event_msg", payload: { type: "user_message", message: "# AGENTS.md instructions\n<INSTRUCTIONS>setup</INSTRUCTIONS>" } },
      user("<environment_context>\ncwd\n</environment_context>"), user("Fix the parser")]);
    const state = await parseCodexSession(file, "codex:one");
    expect(state.messages.map(x => x.type)).toEqual(["system", "system", "user"]);
    expect(state.userMsgCount).toBe(1);
    expect(state.firstPrompt).toBe("Fix the parser");
  });

  it("counts equal last-token snapshots from separate timestamps", async () => {
    const root = dir(), file = join(root, "last-only.jsonl");
    const last = (timestamp: string) => ({ type: "event_msg", timestamp, payload: { type: "token_count", info: { last_token_usage: { input_tokens: 20, output_tokens: 5 } } } });
    lines(file, [{ type: "turn_context", payload: { model: "gpt-a" } }, last("2026-09-26T10:00:00Z"), last("2026-09-26T10:00:01Z")]);
    const state = await parseCodexSession(file, "codex:one");
    expect(state.tokenUsage["gpt-a"]).toEqual({ input: 40, output: 10, cacheRead: 0, cacheCreation: 0 });
  });

  it("keeps image data out of searchable tool results while preserving source JSON", async () => {
    const root = dir(), file = join(root, "image-output.jsonl");
    const raw = { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "call_1", output: [
      { type: "text", text: "Found the chart" },
      { type: "input_image", image_url: "data:image/png;base64," + "A".repeat(4000) },
      { type: "output_text", text: "Result: " + "x".repeat(3000) },
    ] } };
    lines(file, [raw]);
    const state = await parseCodexSession(file, "codex:one");
    const row = state.messages[0]!;
    expect(row.type).toBe("tool-result");
    expect(row.textContent).toContain("Found the chart");
    expect(row.textContent).toContain("[image]");
    expect(row.textContent).not.toContain("data:image");
    expect(row.textContent!.length).toBeLessThanOrEqual(2000);
    expect(row.rawJson).toBe(JSON.stringify(raw));
  });

  it("indexes image-only user messages as a short attachment marker", async () => {
    const root = dir(), file = join(root, "user-image.jsonl");
    const raw = { type: "response_item", payload: { type: "message", role: "user", content: [
      { type: "input_image", image_url: "data:image/png;base64," + "A".repeat(4000) },
    ] } };
    lines(file, [raw]);
    const state = await parseCodexSession(file, "codex:one");
    expect(state.messages[0]?.textContent).toBe("[image attachment]");
    expect(state.messages[0]?.rawJson).toBe(JSON.stringify(raw));
    expect(state.userMsgCount).toBe(1);
  });
});

describe("Codex metadata scan", () => {
  it("ignores metadata after the bounded discovery prelude", async () => {
    const root = dir(), file = join(root, "late.jsonl");
    lines(file, [...Array.from({ length: 65 }, () => "not-json"), { type: "session_meta", payload: { id: "late", cwd: "/work" } }]);
    expect(await walkCodexSessions([root])).toEqual([]);
  });
});
