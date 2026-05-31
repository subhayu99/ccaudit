import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { indexAll } from "../src/indexer/index-runner.js";
import { getSessionMessages, searchMessages } from "../src/db/messages.js";

const userLine = (text: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";

describe("incremental append indexing", () => {
  let tmp: string, baseDir: string, file: string, dbPath: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-inc-"));
    baseDir = join(tmp, "projects");
    mkdirSync(join(baseDir, "-Users-x-proj"), { recursive: true });
    file = join(baseDir, "-Users-x-proj", "sess-1.jsonl");
    dbPath = join(tmp, "i.db");
    writeFileSync(file, userLine("alpha") + userLine("bravo") + userLine("charlie"));
    db = openDb(dbPath);
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  const line1Uuid = () =>
    (db.prepare("SELECT uuid FROM messages WHERE session_id = ? AND line_no = 1").get("sess-1") as any)?.uuid;

  it("appends only the new messages when a session file grows (existing rows untouched)", async () => {
    await indexAll(db, { baseDir });
    expect(getSessionMessages(db, "sess-1")).toHaveLength(3);
    // Stamp an existing row. An append leaves it alone; a delete+reinsert wipes it.
    db.prepare("UPDATE messages SET uuid = 'KEEP-ME' WHERE session_id = 'sess-1' AND line_no = 1").run();

    // The session continues: two new lines appended (file grows).
    appendFileSync(file, userLine("delta") + userLine("echo"));
    await indexAll(db, { baseDir });

    const msgs = getSessionMessages(db, "sess-1");
    expect(msgs).toHaveLength(5); // old 3 + new 2, no duplicates
    expect(new Set(msgs.map((m) => m.lineNo)).size).toBe(5);
    expect(line1Uuid()).toBe("KEEP-ME"); // existing row preserved → appended, not rebuilt
    // Both old and new content remain searchable (FTS stays in sync).
    expect(searchMessages(db, "alpha", { limit: 5 })).toHaveLength(1);
    expect(searchMessages(db, "echo", { limit: 5 })).toHaveLength(1);
  });

  it("skips entirely when nothing changed (mtime+size identical)", async () => {
    expect((await indexAll(db, { baseDir })).sessionsIndexed).toBe(1);
    const s2 = await indexAll(db, { baseDir });
    expect(s2.sessionsIndexed).toBe(0);
    expect(s2.sessionsSkipped).toBe(1);
  });

  it("does a full re-index (delete+insert) under --force, with no duplication", async () => {
    await indexAll(db, { baseDir });
    db.prepare("UPDATE messages SET uuid = 'KEEP-ME' WHERE session_id = 'sess-1' AND line_no = 1").run();
    await indexAll(db, { baseDir, force: true });
    expect(getSessionMessages(db, "sess-1")).toHaveLength(3); // rebuilt, not doubled
    expect(line1Uuid()).not.toBe("KEEP-ME"); // force rebuilds the rows from the file
    expect(searchMessages(db, "alpha", { limit: 5 })).toHaveLength(1);
  });
});
