import { describe, it, expect } from "vitest";
import { authorOf } from "./message-kind.js";
import type { MessageRow } from "../types.js";

function msg(p: Partial<MessageRow> & { type: string }): MessageRow {
  return {
    sessionId: "s",
    lineNo: 1,
    uuid: null,
    parentUuid: null,
    type: p.type,
    role: p.role ?? null,
    isSidechain: p.isSidechain ?? false,
    isCompactSummary: p.isCompactSummary ?? false,
    timestamp: null,
    textContent: p.textContent ?? null,
    rawJson: p.rawJson ?? "{}",
  };
}

describe("authorOf", () => {
  it("maps user / assistant text turns", () => {
    expect(authorOf(msg({ type: "user", role: "user", textContent: "hi" }))).toBe("user");
    expect(authorOf(msg({ type: "assistant", role: "assistant", textContent: "hello" }))).toBe("assistant");
  });

  it("maps tool_use and tool_result turns to tool", () => {
    const toolUse = msg({ type: "assistant", textContent: "", rawJson: JSON.stringify({ message: { content: [{ type: "tool_use" }] } }) });
    const toolResult = msg({ type: "user", textContent: "", rawJson: JSON.stringify({ message: { content: [{ type: "tool_result" }] } }) });
    expect(authorOf(toolUse)).toBe("tool");
    expect(authorOf(toolResult)).toBe("tool");
  });

  it("treats sub-agent (sidechain) turns as agent regardless of inner role", () => {
    expect(authorOf(msg({ type: "assistant", role: "assistant", textContent: "from subagent", isSidechain: true }))).toBe("agent");
  });

  it("returns null for noise, empty, and command-echo turns", () => {
    expect(authorOf(msg({ type: "system", textContent: "x" }))).toBeNull();
    expect(authorOf(msg({ type: "user", textContent: "   " }))).toBeNull();
    expect(authorOf(msg({ type: "user", textContent: "<command-name>/clear</command-name>" }))).toBeNull();
    expect(authorOf(msg({ type: "user", isCompactSummary: true, textContent: "summary" }))).toBeNull();
  });
});
