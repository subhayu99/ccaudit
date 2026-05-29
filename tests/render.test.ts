import { describe, it, expect } from "vitest";
import { formatTimestamp, truncate, shortSessionId } from "../src/lib/render.js";
import { classifyMessage } from "../src/lib/message-kind.js";
import type { MessageRow } from "../src/types.js";

describe("lib/render", () => {
  it("formatTimestamp returns a readable string", () => {
    // 2026-05-23T10:00:00Z in ms = 1779530400000
    expect(formatTimestamp(1779530400000)).toMatch(/2026-05-23 \d{2}:\d{2}/);
  });

  it("formatTimestamp returns em dash for null", () => {
    expect(formatTimestamp(null)).toBe("—");
  });

  it("truncate keeps short strings unchanged", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("truncate collapses whitespace and appends ellipsis when too long", () => {
    expect(truncate("a very\n\nlong   string here that won't fit", 12)).toBe("a very long…");
  });

  it("truncate returns '' for null/undefined", () => {
    expect(truncate(null, 10)).toBe("");
    expect(truncate(undefined, 10)).toBe("");
  });

  it("shortSessionId returns first 8 chars", () => {
    expect(shortSessionId("09a39a76-b1d4-4a22-9b9d-0b33175a09a3")).toBe("09a39a76");
  });
});

describe("lib/message-kind", () => {
  const baseRow = (overrides: Partial<MessageRow> & { rawJson?: string }): MessageRow => ({
    sessionId: "s", lineNo: 1, uuid: null, parentUuid: null,
    type: "user", role: null, isSidechain: false, isCompactSummary: false,
    timestamp: null, textContent: null, rawJson: "{}", ...overrides,
  });

  it("classifies a plain user message as user-text", () => {
    expect(classifyMessage(baseRow({
      type: "user",
      textContent: "hello",
      rawJson: JSON.stringify({ message: { content: "hello" } }),
    }))).toBe("user-text");
  });

  it("classifies an assistant message with tool_use as tool-use", () => {
    expect(classifyMessage(baseRow({
      type: "assistant",
      rawJson: JSON.stringify({ message: { content: [{ type: "tool_use", name: "Read" }] } }),
    }))).toBe("tool-use");
  });

  it("classifies a user message carrying tool_result as tool-result", () => {
    expect(classifyMessage(baseRow({
      type: "user",
      rawJson: JSON.stringify({ message: { content: [{ type: "tool_result", content: "" }] } }),
    }))).toBe("tool-result");
  });

  it("classifies isCompactSummary regardless of type", () => {
    expect(classifyMessage(baseRow({ type: "assistant", isCompactSummary: true }))).toBe("compact-summary");
  });

  it("classifies isSidechain regardless of type", () => {
    expect(classifyMessage(baseRow({ type: "assistant", isSidechain: true }))).toBe("sidechain");
  });

  it("classifies attachment with a real filename as attachment", () => {
    expect(classifyMessage(baseRow({ type: "attachment", textContent: "[attachment: diagram.png]" }))).toBe("attachment");
  });

  it("classifies internal/system message types as noise", () => {
    for (const t of ["last-prompt", "permission-mode", "queue-operation", "file-history-snapshot", "ai-title", "system", "agent-name"]) {
      expect(classifyMessage(baseRow({ type: t, textContent: "whatever" }))).toBe("noise");
    }
  });

  it("classifies empty user/assistant turns as noise", () => {
    expect(classifyMessage(baseRow({ type: "assistant", textContent: null, rawJson: "{}" }))).toBe("noise");
    expect(classifyMessage(baseRow({ type: "user", textContent: "   ", rawJson: "{}" }))).toBe("noise");
  });

  it("classifies attachment with unknown filename as noise", () => {
    expect(classifyMessage(baseRow({ type: "attachment", textContent: "[attachment: unknown]" }))).toBe("noise");
  });
});
