import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { getSession, upsertSession } from "../src/db/sessions.js";
import type { Session } from "../src/types.js";

const session: Session = {
  id: "same-id", projectDir: "/tmp", projectLabel: "tmp", filePath: "/tmp/claude.jsonl",
  fileMtime: 1, fileSize: 1, startedAt: null, lastActivity: null, gitBranch: null,
  messageCount: 0, userMsgCount: 0, compactCount: 0, firstPrompt: null, aiTitle: null,
  cwd: "/tmp", indexedAt: 1,
};
describe("session providers", () => {
  it("defaults old producers to Claude and round-trips Codex without colliding", () => {
    const db = openDb(":memory:");
    try {
      upsertSession(db, session);
      upsertSession(db, { ...session, id: "codex:same-id", provider: "codex", filePath: "/tmp/codex.jsonl" } as Session);
      expect(getSession(db, "same-id")).toHaveProperty("provider", "claude");
      expect(getSession(db, "codex:same-id")).toHaveProperty("provider", "codex");
    } finally { db.close(); }
  });
  it("migrates an existing index without losing sessions", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ccaudit-migrate-"));
    const file = join(tmp, "index.db");
    const old = openDb(file);
    upsertSession(old, session);
    old.exec("ALTER TABLE sessions DROP COLUMN provider");
    old.close();
    const migrated = openDb(file);
    try {
      expect(getSession(migrated, "same-id")).toMatchObject({ provider: "claude", filePath: "/tmp/claude.jsonl" });
    } finally { migrated.close(); rmSync(tmp, { recursive: true, force: true }); }
  });
});
