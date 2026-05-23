import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";

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
