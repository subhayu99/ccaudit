import { describe, it, expect } from "vitest";
import { renderSessionMarkdown, exportFilename, sessionTitle } from "./session-export.js";
import type { MessageRow, Session } from "../types.js";

const session: Session = {
  id: "abcdef12-3456-7890-aaaa-bbbbccccdddd",
  projectDir: "/Users/me/Downloads/proj",
  projectLabel: "Downloads/proj",
  filePath: "/x.jsonl",
  fileMtime: 0,
  fileSize: 0,
  startedAt: 1_700_000_000_000,
  lastActivity: 1_700_000_100_000,
  gitBranch: "main",
  messageCount: 5,
  userMsgCount: 2,
  compactCount: 1,
  firstPrompt: "hello there",
  aiTitle: "Wire up the auth flow",
  cwd: "/Users/me/Downloads/proj",
  indexedAt: 0,
};

function msg(p: Partial<MessageRow> & { type: string }): MessageRow {
  return {
    sessionId: session.id,
    lineNo: p.lineNo ?? 1,
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

const messages: MessageRow[] = [
  msg({ lineNo: 1, type: "user", role: "user", textContent: "How do I add login?" }),
  msg({ lineNo: 2, type: "assistant", role: "assistant", textContent: "Use sessions." }),
  msg({ lineNo: 3, type: "system", textContent: "internal noise" }), // dropped
  msg({
    lineNo: 4,
    type: "assistant",
    textContent: "",
    rawJson: JSON.stringify({ message: { content: [{ type: "tool_use" }] } }),
  }), // tool — clean drops, raw keeps (but it has no text → dropped either way)
  msg({ lineNo: 5, type: "user", textContent: "<command-name>/clear</command-name>" }), // command echo — dropped
];

describe("renderSessionMarkdown", () => {
  it("includes the title and key metadata", () => {
    const md = renderSessionMarkdown(session, messages);
    expect(md).toContain("# Wire up the auth flow");
    expect(md).toContain("**Branch:** main");
    expect(md).toContain("`abcdef12-3456-7890-aaaa-bbbbccccdddd`");
    expect(md).toContain("1 compaction(s)");
  });

  it("keeps user + assistant turns, drops noise & command echoes", () => {
    const md = renderSessionMarkdown(session, messages);
    expect(md).toContain("### User");
    expect(md).toContain("How do I add login?");
    expect(md).toContain("### Assistant");
    expect(md).toContain("Use sessions.");
    expect(md).not.toContain("internal noise");
    expect(md).not.toContain("/clear");
  });
});

describe("exportFilename / sessionTitle", () => {
  it("slugifies the title and appends the short id", () => {
    expect(exportFilename(session, "md")).toBe("ccaudit-wire-up-the-auth-flow-abcdef12.md");
    expect(exportFilename(session, "html")).toBe("ccaudit-wire-up-the-auth-flow-abcdef12.html");
  });

  it("falls back to first prompt then id for the title", () => {
    expect(sessionTitle({ ...session, aiTitle: null })).toBe("hello there");
    expect(sessionTitle({ ...session, aiTitle: null, firstPrompt: null })).toBe(session.id);
  });
});
