import { describe, it, expect } from "vitest";
import { classifyMessage } from "../src/lib/message-kind.js";
import type { MessageRow } from "../src/types.js";

function msg(p: Partial<MessageRow> = {}): MessageRow {
  return {
    sessionId: "s", lineNo: 0, uuid: null, parentUuid: null, type: "user",
    role: "user", isSidechain: false, isCompactSummary: false, timestamp: 1,
    textContent: "hello", rawJson: JSON.stringify({ message: { content: "hello" } }), ...p,
  };
}

describe("classifyMessage — command / caveat de-noise", () => {
  it("classifies a slash-command echo as noise", () => {
    expect(classifyMessage(msg({ textContent: "<command-name>/context</command-name>" }))).toBe("noise");
  });
  it("classifies a local-command-caveat as noise", () => {
    expect(classifyMessage(msg({ textContent: "<local-command-caveat>Caveat: messages below…</local-command-caveat>" }))).toBe("noise");
  });
  it("classifies command-message / command-args wrappers as noise", () => {
    expect(classifyMessage(msg({ textContent: "<command-message>context</command-message>" }))).toBe("noise");
    expect(classifyMessage(msg({ textContent: "<command-args></command-args>" }))).toBe("noise");
  });
  it("still classifies a real user turn as user-text", () => {
    expect(classifyMessage(msg({ textContent: "Fix the login bug" }))).toBe("user-text");
  });
  it("does not misclassify a message that merely mentions a command tag mid-text", () => {
    expect(classifyMessage(msg({ textContent: "I used <command-name> in my example earlier" }))).toBe("user-text");
  });
});
