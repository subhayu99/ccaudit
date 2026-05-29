import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { insertMessages } from "../src/db/messages.js";
import type { Session } from "../src/types.js";
import { toolListSessions, toolSearchSessions, toolGetSession } from "../src/mcp/tools.js";

describe("mcp/tools", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-mcp-"));
    db = openDb(join(tmp, "test.db"));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const sess = (id: string, over: Partial<Session> = {}): Session => ({
    id,
    projectDir: "/p",
    projectLabel: "proj",
    filePath: `/p/${id}.jsonl`,
    fileMtime: 0,
    fileSize: 0,
    startedAt: 100,
    lastActivity: 200,
    gitBranch: "main",
    messageCount: 3,
    userMsgCount: 1,
    compactCount: 0,
    firstPrompt: "hello there",
    aiTitle: null,
    cwd: "/p",
    indexedAt: 0,
    ...over,
  });

  it("toolListSessions returns summaries", () => {
    upsertSession(db, sess("a"));
    const r = toolListSessions(db, { limit: 10 });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("a");
    expect(r[0]!.project).toBe("proj");
    expect(r[0]!.firstPrompt).toBe("hello there");
  });

  it("toolSearchSessions returns clean snippets (no <mark> tags)", () => {
    upsertSession(db, sess("a"));
    insertMessages(db, [
      {
        sessionId: "a",
        lineNo: 1,
        uuid: null,
        parentUuid: null,
        type: "user",
        role: "user",
        isSidechain: false,
        isCompactSummary: false,
        timestamp: null,
        textContent: "deploying the widget service",
        rawJson: "{}",
      },
    ]);
    const r = toolSearchSessions(db, { query: "widget" });
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0]!.sessionId).toBe("a");
    expect(r[0]!.snippet).not.toContain("<mark>");
    expect(r[0]!.snippet.toLowerCase()).toContain("widget");
  });

  it("toolGetSession returns metadata, and messages when requested", () => {
    upsertSession(db, sess("a"));
    insertMessages(db, [
      {
        sessionId: "a",
        lineNo: 1,
        uuid: null,
        parentUuid: null,
        type: "user",
        role: "user",
        isSidechain: false,
        isCompactSummary: false,
        timestamp: null,
        textContent: "real message",
        rawJson: "{}",
      },
      {
        sessionId: "a",
        lineNo: 2,
        uuid: null,
        parentUuid: null,
        type: "file-history-snapshot",
        role: null,
        isSidechain: false,
        isCompactSummary: false,
        timestamp: null,
        textContent: null,
        rawJson: "{}",
      },
    ]);
    const meta = toolGetSession(db, { sessionId: "a" });
    expect((meta as any).id).toBe("a");
    expect((meta as any).messages).toBeUndefined();

    const withMsgs = toolGetSession(db, { sessionId: "a", includeMessages: true }) as any;
    expect(withMsgs.messages).toHaveLength(1); // noise (file-history-snapshot) filtered out
    expect(withMsgs.messages[0].text).toBe("real message");
  });

  it("toolGetSession returns error for unknown session", () => {
    const r = toolGetSession(db, { sessionId: "nope" }) as any;
    expect(r.error).toBe("session not found");
  });
});
