import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db/init.js";
import { insertMessages } from "../src/db/messages.js";
import { searchMessages, escapeFtsQuery, escapeFtsQueryAny } from "../src/db/messages.js";
import { upsertSession } from "../src/db/sessions.js";
import type { Session } from "../src/types.js";

function mkSession(id: string): Session {
  return {
    id, projectDir: "/p", projectLabel: "p", filePath: "/p/" + id + ".jsonl",
    fileMtime: 1, fileSize: 1, startedAt: 1, lastActivity: 1, gitBranch: null,
    messageCount: 1, userMsgCount: 1, compactCount: 0, firstPrompt: null,
    aiTitle: null, cwd: null, indexedAt: 1, tokenUsage: null,
  };
}

describe("FTS query escaping (no crash on operators/punctuation)", () => {
  let dir: string, db: ReturnType<typeof openDb>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ccaudit-fts-"));
    db = openDb(join(dir, "t.db"));
    upsertSession(db, mkSession("s1"));
    insertMessages(db, [{
      sessionId: "s1", lineNo: 1, uuid: "u1", parentUuid: null, type: "user", role: "user",
      isSidechain: false, isCompactSummary: false, timestamp: 1,
      textContent: "how do I deploy the webhook (stripe) handler?", rawJson: "{}",
    }]);
  });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it("does not throw on a question with ? and parentheses, and still matches", () => {
    for (const q of ["deploy the webhook?", "stripe (handler)", "deploy AND OR", "foo\"", "*"]) {
      expect(() => searchMessages(db, q)).not.toThrow();
    }
    expect(searchMessages(db, "deploy webhook?").length).toBeGreaterThan(0);
  });

  it("escapeFtsQuery quotes each term (AND); escapeFtsQueryAny joins with OR", () => {
    expect(escapeFtsQuery("foo bar?")).toBe('"foo" "bar?"');
    expect(escapeFtsQuery('a "b')).toBe('"a" """b"');
    expect(escapeFtsQuery("   ")).toBe("");
    expect(escapeFtsQueryAny("foo bar")).toBe('"foo" OR "bar"');
  });

  it("match:'any' (OR) recalls a message that matches only some terms", () => {
    // AND requires all terms (none here co-occur with 'unrelated'); OR matches on 'deploy'/'webhook'.
    expect(searchMessages(db, "deploy unrelated nonexistent", { match: "all" })).toHaveLength(0);
    expect(searchMessages(db, "deploy unrelated nonexistent", { match: "any" }).length).toBeGreaterThan(0);
  });
});
