import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { addExclusion } from "../src/db/exclusions.js";
import {
  insertMessages,
  searchMessages,
  searchMessagesExact,
  searchMessagesRegex,
} from "../src/db/messages.js";
import type { MessageRow, Session } from "../src/types.js";

function sess(id: string, cwd: string): Session {
  return {
    id, projectDir: cwd, projectLabel: cwd, filePath: `/p/${id}.jsonl`,
    fileMtime: 0, fileSize: 0, startedAt: null, lastActivity: null, gitBranch: null,
    messageCount: 0, userMsgCount: 0, compactCount: 0, firstPrompt: null,
    aiTitle: null, cwd, indexedAt: 0,
  };
}
const msg = (sessionId: string, lineNo: number, text: string): MessageRow => ({
  sessionId, lineNo, uuid: null, parentUuid: null, type: "user", role: "user",
  isSidechain: false, isCompactSummary: false, timestamp: null,
  textContent: text, rawJson: "{}",
});

describe("message search exclusion short-circuit", () => {
  let tmp: string, db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-msgexcl-"));
    db = openDb(join(tmp, "t.db"));
    upsertSession(db, sess("keep", "/work/keep"));
    upsertSession(db, sess("obs", "/work/obs"));
    insertMessages(db, [
      msg("keep", 1, "the quick brown fox runs"),
      msg("obs", 1, "the quick brown fox hides"),
    ]);
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("FTS search returns identical results with no exclusions (short-circuit branch)", () => {
    const hits = searchMessages(db, "fox");
    expect(hits.map((h) => h.sessionId).sort()).toEqual(["keep", "obs"]);
  });

  it("exact search returns identical results with no exclusions", () => {
    const hits = searchMessagesExact(db, "fox");
    expect(hits.map((h) => h.sessionId).sort()).toEqual(["keep", "obs"]);
  });

  it("regex search returns identical results with no exclusions", () => {
    const hits = searchMessagesRegex(db, "f.x");
    expect(hits.map((h) => h.sessionId).sort()).toEqual(["keep", "obs"]);
  });

  it("FTS search still filters out excluded sessions", () => {
    addExclusion(db, "/work/obs");
    const hits = searchMessages(db, "fox");
    expect(hits.map((h) => h.sessionId)).toEqual(["keep"]);
  });

  it("exact search still filters out excluded sessions", () => {
    addExclusion(db, "/work/obs");
    const hits = searchMessagesExact(db, "fox");
    expect(hits.map((h) => h.sessionId)).toEqual(["keep"]);
  });

  it("regex search still filters out excluded sessions", () => {
    addExclusion(db, "/work/obs");
    const hits = searchMessagesRegex(db, "f.x");
    expect(hits.map((h) => h.sessionId)).toEqual(["keep"]);
  });
});
