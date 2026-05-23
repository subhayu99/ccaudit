import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession, getSession, listSessions } from "../src/db/sessions.js";
import type { Session } from "../src/types.js";

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
