import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { upsertWorkdir } from "../src/db/workdirs.js";
import { insertMessages, searchMessages } from "../src/db/messages.js";
import { addRule, listRules } from "../src/db/exclusions.js";
import { getLibraryTree } from "../src/db/library.js";
import type { Session } from "../src/types.js";
import type { MessageRow } from "../src/types.js";

function sess(id: string, title: string): Session {
  return {
    id, projectDir: "/w/a", projectLabel: "a", filePath: `/p/${id}.jsonl`,
    fileMtime: 1, fileSize: 1, startedAt: 1, lastActivity: 1, gitBranch: null,
    messageCount: 2, userMsgCount: 1, compactCount: 0, firstPrompt: title,
    aiTitle: title, cwd: "/w/a", indexedAt: 1,
  };
}
function msg(sessionId: string, lineNo: number, type: "user" | "assistant", text: string): MessageRow {
  return {
    sessionId, lineNo, uuid: `${sessionId}-${lineNo}`, parentUuid: null, type,
    role: type, isSidechain: false, isCompactSummary: false, timestamp: 1,
    textContent: text, rawJson: JSON.stringify({ type, message: { role: type, content: text } }),
  };
}

// Flatten the library tree to the set of visible session ids.
const visibleIds = (db: ReturnType<typeof openDb>) =>
  getLibraryTree(db).repos.flatMap((r) => r.workdirs.flatMap((w) => w.sessions.map((s) => s.id))).sort();

describe("hide rules (sessionKeepCondition)", () => {
  let tmp: string, dbPath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-hide-"));
    dbPath = join(tmp, "t.db");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function seed() {
    const db = openDb(dbPath);
    upsertWorkdir(db, { path: "/w/a", kind: "git", remote: "github.com/o/a", manifestName: null, rootCommit: null, existsOnDisk: true, tokens: ["c1"], resolvedAt: 1 });
    upsertSession(db, sess("s_titlematch", "Probe response test"));
    upsertSession(db, sess("s_usermatch", "Normal work"));
    upsertSession(db, sess("s_aimatch", "Other work"));
    upsertSession(db, sess("s_keep", "Keep me around"));
    insertMessages(db, [
      msg("s_usermatch", 1, "user", "please run a probe against the server"),
      msg("s_aimatch", 1, "assistant", "here is a probe you could run"), // assistant only — must NOT hide
      msg("s_keep", 1, "user", "totally unrelated content"),
    ]);
    return db;
  }

  it("phrase rule hides sessions matching the title OR a user message, ignoring assistant messages", () => {
    const db = seed();
    expect(visibleIds(db)).toEqual(["s_aimatch", "s_keep", "s_titlematch", "s_usermatch"]);
    addRule(db, "phrase", "probe");
    expect(visibleIds(db)).toEqual(["s_aimatch", "s_keep"]); // title + user-message matches hidden; assistant-only kept
  });

  it("session-id rule hides exactly that session", () => {
    const db = seed();
    addRule(db, "session", "s_keep");
    expect(visibleIds(db)).toEqual(["s_aimatch", "s_titlematch", "s_usermatch"]);
  });

  it("regex rule (case-insensitive) hides matching titles", () => {
    const db = seed();
    addRule(db, "regex", "^probe");
    expect(visibleIds(db)).toEqual(["s_aimatch", "s_keep", "s_usermatch"]); // only the title starting with Probe hidden
  });

  it("search results also respect a phrase rule (assistant-only matches survive)", () => {
    const db = seed();
    const ids = (q: string) => searchMessages(db, q, { limit: 50 }).map((h) => h.sessionId);
    // 'probe' is in s_usermatch (user msg) and s_aimatch (assistant msg).
    expect(ids("probe").sort()).toEqual(["s_aimatch", "s_usermatch"]);
    addRule(db, "phrase", "probe");
    // s_usermatch hidden (user msg matches); s_aimatch stays (only its assistant msg matched).
    expect(ids("probe")).toEqual(["s_aimatch"]);
  });

  it("listRules returns added rules", () => {
    const db = seed();
    addRule(db, "phrase", "probe");
    addRule(db, "session", "s_keep");
    expect(listRules(db).map((r) => `${r.kind}:${r.value}`).sort()).toEqual(["phrase:probe", "session:s_keep"]);
  });
});
