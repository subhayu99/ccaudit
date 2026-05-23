import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession, getSession, listSessions } from "../src/db/sessions.js";
import type { Session } from "../src/types.js";
import {
  insertMessages,
  deleteSessionMessages,
  getSessionMessages,
  searchMessages,
} from "../src/db/messages.js";
import type { MessageRow } from "../src/types.js";
import { addTag, removeTag, getSessionTags, getSessionsByTag } from "../src/db/tags.js";

describe("db/init", () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    dbPath = join(tmp, "test.db");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates the sessions, messages, tags, exports tables and the FTS5 vtable", () => {
    const db = openDb(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual') ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "sessions",
        "messages",
        "messages_fts",
        "session_tags",
        "session_exports",
      ])
    );
    db.close();
  });

  it("creates the three FTS5 sync triggers on the messages table", () => {
    const db = openDb(dbPath);
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = triggers.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "messages_ai", // after insert
        "messages_ad", // after delete
        "messages_au", // after update
      ])
    );
    db.close();
  });
});

describe("db/sessions", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const fixture = (overrides: Partial<Session> = {}): Session => ({
    id: "sess-1",
    projectDir: "/Users/x/proj",
    projectLabel: "x/proj",
    filePath: "/tmp/sess-1.jsonl",
    fileMtime: 1000,
    fileSize: 42,
    startedAt: 900,
    lastActivity: 950,
    gitBranch: "main",
    messageCount: 5,
    userMsgCount: 2,
    compactCount: 0,
    firstPrompt: "hello",
    aiTitle: null,
    indexedAt: 1100,
    ...overrides,
  });

  it("upserts and retrieves a session", () => {
    upsertSession(db, fixture());
    const got = getSession(db, "sess-1");
    expect(got).not.toBeNull();
    expect(got!.projectLabel).toBe("x/proj");
    expect(got!.messageCount).toBe(5);
  });

  it("upsert replaces existing row", () => {
    upsertSession(db, fixture());
    upsertSession(db, fixture({ messageCount: 99 }));
    expect(getSession(db, "sess-1")!.messageCount).toBe(99);
  });

  it("listSessions orders by last_activity desc and applies limit/offset", () => {
    upsertSession(db, fixture({ id: "a", lastActivity: 100 }));
    upsertSession(db, fixture({ id: "b", lastActivity: 200 }));
    upsertSession(db, fixture({ id: "c", lastActivity: 150 }));
    const rows = listSessions(db, { limit: 10, offset: 0 });
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("listSessions filters by project_dir", () => {
    upsertSession(db, fixture({ id: "a", projectDir: "/p1" }));
    upsertSession(db, fixture({ id: "b", projectDir: "/p2" }));
    const rows = listSessions(db, { projectDir: "/p1" });
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("db/messages", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
    upsertSession(db, {
      id: "s1",
      projectDir: "/p",
      projectLabel: "p",
      filePath: "/p/s1.jsonl",
      fileMtime: 0,
      fileSize: 0,
      startedAt: null,
      lastActivity: null,
      gitBranch: null,
      messageCount: 0,
      userMsgCount: 0,
      compactCount: 0,
      firstPrompt: null,
      aiTitle: null,
      indexedAt: 0,
    });
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const msg = (overrides: Partial<MessageRow>): MessageRow => ({
    sessionId: "s1",
    lineNo: 1,
    uuid: null,
    parentUuid: null,
    type: "user",
    role: "user",
    isSidechain: false,
    isCompactSummary: false,
    timestamp: null,
    textContent: "hello world",
    rawJson: "{}",
    ...overrides,
  });

  it("inserts and retrieves messages in line order", () => {
    insertMessages(db, [msg({ lineNo: 2, textContent: "second" }), msg({ lineNo: 1, textContent: "first" })]);
    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.lineNo)).toEqual([1, 2]);
    expect(rows[0]!.textContent).toBe("first");
  });

  it("deleteSessionMessages removes all rows for a session", () => {
    insertMessages(db, [msg({ lineNo: 1 }), msg({ lineNo: 2 })]);
    deleteSessionMessages(db, "s1");
    expect(getSessionMessages(db, "s1")).toEqual([]);
  });

  it("FTS5 search returns messages matching the query", () => {
    insertMessages(db, [
      msg({ lineNo: 1, textContent: "the quick brown fox" }),
      msg({ lineNo: 2, textContent: "lazy dog jumps" }),
    ]);
    const hits = searchMessages(db, "fox");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sessionId).toBe("s1");
    expect(hits[0]!.lineNo).toBe(1);
    expect(hits[0]!.snippet).toContain("fox");
  });

  it("FTS5 search applies porter stemming", () => {
    insertMessages(db, [msg({ lineNo: 1, textContent: "the dogs were running" })]);
    const hits = searchMessages(db, "dog");
    expect(hits).toHaveLength(1);
  });
});

describe("db/tags", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
    for (const id of ["s1", "s2"]) {
      upsertSession(db, {
        id, projectDir: "/p", projectLabel: "p", filePath: `/p/${id}.jsonl`,
        fileMtime: 0, fileSize: 0, startedAt: null, lastActivity: null,
        gitBranch: null, messageCount: 0, userMsgCount: 0, compactCount: 0,
        firstPrompt: null, aiTitle: null, indexedAt: 0,
      });
    }
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it("adds and lists tags for a session", () => {
    addTag(db, "s1", "Audit", Date.now());
    addTag(db, "s1", "ops", Date.now());
    expect(getSessionTags(db, "s1").sort()).toEqual(["Audit", "ops"]);
  });

  it("addTag is idempotent (same case)", () => {
    addTag(db, "s1", "ops", Date.now());
    addTag(db, "s1", "ops", Date.now());
    expect(getSessionTags(db, "s1")).toEqual(["ops"]);
  });

  it("getSessionsByTag is case-insensitive but display case is preserved", () => {
    addTag(db, "s1", "Audit", Date.now());
    addTag(db, "s2", "audit", Date.now());
    const hits = getSessionsByTag(db, "AUDIT");
    expect(hits.sort()).toEqual(["s1", "s2"]);
  });

  it("removeTag removes only the matching tag", () => {
    addTag(db, "s1", "ops", Date.now());
    addTag(db, "s1", "Audit", Date.now());
    removeTag(db, "s1", "ops");
    expect(getSessionTags(db, "s1")).toEqual(["Audit"]);
  });
});
