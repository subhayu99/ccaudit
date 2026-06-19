import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../db/init.js";
import { upsertSession } from "../db/sessions.js";
import { insertMessages } from "../db/messages.js";
import { backfillInference } from "./backfill-inference.js";
import type { Session, MessageRow } from "../types.js";
import type { DirKind } from "../lib/session-dirs.js";

let tmp: string;
let db: Db;

// Two git repos: proj-a (launch) and proj-b (where the work points).
const resolve = (p: string): DirKind => {
  if (p === "/w/proj-a/.git" || p === "/w/proj-b/.git") return "dir";
  if (["/w/proj-a", "/w/proj-b", "/w/proj-b/src"].includes(p)) return "dir";
  if (p.endsWith(".ts")) return "file";
  return "missing";
};

function seedUninferred(id: string, cwd: string, rawLines: string[]): void {
  const s: Session = {
    id, projectDir: cwd, projectLabel: "x", filePath: "/f/" + id,
    fileMtime: 1, fileSize: 1, startedAt: 1, lastActivity: 1, gitBranch: null,
    messageCount: rawLines.length, userMsgCount: 0, compactCount: 0,
    firstPrompt: null, aiTitle: null, cwd, indexedAt: 1, tokenUsage: null,
    inferredDir: null, inferredHits: 0, inferredLaunchHits: 0,
  };
  upsertSession(db, s);
  // Simulate a row indexed before inference existed.
  db.prepare("UPDATE sessions SET inferred_at = NULL WHERE id = ?").run(id);
  const msgs: MessageRow[] = rawLines.map((raw, i) => ({
    sessionId: id, lineNo: i, uuid: null, parentUuid: null, type: "assistant",
    role: "assistant", isSidechain: false, isCompactSummary: false, timestamp: 1,
    textContent: null, rawJson: raw,
  }));
  insertMessages(db, msgs);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ccaudit-backfill-"));
  db = openDb(join(tmp, "index.db"));
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("backfillInference", () => {
  it("computes inference for un-inferred rows and stamps inferred_at exactly once", () => {
    const refB = '{"file_path":"/w/proj-b/src/app.ts"}';
    seedUninferred("misfiled", "/w/proj-a", Array(6).fill(refB)); // launched proj-a, work in proj-b
    seedUninferred("clean", "/w/proj-b", Array(6).fill(refB)); // launched proj-b, work in proj-b

    const n = backfillInference(db, { resolve, home: "/w", now: () => 999 });
    expect(n).toBe(2);

    const m = db.prepare("SELECT inferred_dir, inferred_hits, inferred_at FROM sessions WHERE id = 'misfiled'").get() as any;
    expect(m.inferred_dir).toBe("/w/proj-b");
    expect(m.inferred_hits).toBeGreaterThanOrEqual(5);
    expect(m.inferred_at).toBe(999);

    const c = db.prepare("SELECT inferred_dir, inferred_at FROM sessions WHERE id = 'clean'").get() as any;
    expect(c.inferred_dir).toBeNull(); // not misfiled...
    expect(c.inferred_at).toBe(999); // ...but still stamped, so it won't be re-processed

    // Idempotent: a second pass finds nothing to do.
    expect(backfillInference(db, { resolve })).toBe(0);
  });
});
