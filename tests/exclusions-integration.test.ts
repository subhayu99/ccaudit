import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession, listSessions, listProjects } from "../src/db/sessions.js";
import { insertMessages, searchMessages, searchMessagesExact } from "../src/db/messages.js";
import { getIndexStats } from "../src/db/stats.js";
import { getGraphData } from "../src/db/graph.js";
import { addExclusion } from "../src/db/exclusions.js";
import type { Session, MessageRow } from "../src/types.js";

function session(id: string, projectDir: string): Session {
  return {
    id, projectDir, projectLabel: projectDir, filePath: `/p/${id}.jsonl`,
    fileMtime: 1, fileSize: 1, startedAt: 1, lastActivity: 1, gitBranch: null,
    messageCount: 1, userMsgCount: 1, compactCount: 0, firstPrompt: "hi",
    aiTitle: null, cwd: projectDir, indexedAt: 1,
  };
}
function msg(sessionId: string, text: string): MessageRow {
  return {
    sessionId, lineNo: 0, uuid: null, parentUuid: null, type: "user", role: "user",
    isSidechain: false, isCompactSummary: false, timestamp: 1, textContent: text,
    rawJson: "{}",
  };
}

describe("exclusions applied to read paths", () => {
  let tmp: string, dbPath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-exi-"));
    dbPath = join(tmp, "test.db");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function seed(db: ReturnType<typeof openDb>) {
    upsertSession(db, session("keep", "/work/backend"));
    upsertSession(db, session("obs", "/home/.claude-mem/observer/sessions"));
    insertMessages(db, [msg("keep", "findme in backend")]);
    insertMessages(db, [msg("obs", "findme in observer")]);
    addExclusion(db, "/home/.claude-mem/observer/sessions");
  }

  it("listSessions hides excluded sessions", () => {
    const db = openDb(dbPath);
    seed(db);
    expect(listSessions(db).map((s) => s.id)).toEqual(["keep"]);
  });

  it("listProjects hides excluded projects", () => {
    const db = openDb(dbPath);
    seed(db);
    expect(listProjects(db).map((p) => p.projectDir)).toEqual(["/work/backend"]);
  });

  it("getIndexStats counts only non-excluded sessions", () => {
    const db = openDb(dbPath);
    seed(db);
    expect(getIndexStats(db).totalSessions).toBe(1);
  });

  it("searchMessages / searchMessagesExact skip hits in excluded sessions", () => {
    const db = openDb(dbPath);
    seed(db);
    expect(searchMessages(db, "findme").map((h) => h.sessionId)).toEqual(["keep"]);
    expect(searchMessagesExact(db, "findme").map((h) => h.sessionId)).toEqual(["keep"]);
  });

  it("getGraphData omits excluded sessions and their projects", () => {
    const db = openDb(dbPath);
    seed(db);
    const { nodes } = getGraphData(db);
    expect(nodes.some((n) => n.type === "session" && n.sessionId === "obs")).toBe(false);
    expect(nodes.some((n) => n.id === "proj:/home/.claude-mem/observer/sessions")).toBe(false);
  });
});
