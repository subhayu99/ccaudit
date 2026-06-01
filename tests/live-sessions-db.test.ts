import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertLive, markEnded, listLive, indexedSessionIds } from "../src/db/live-sessions.js";
import type { LiveInstance } from "../src/watch/registry.js";

const inst = (over: Partial<LiveInstance> & { sessionId: string }): LiveInstance => ({
  pid: 1, cwd: "/w", name: "n", status: "waiting", waitingFor: null, version: "2.1", startedAt: 1, updatedAt: 1, ...over,
});

describe("db/live-sessions", () => {
  let tmp: string, dbp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-live-")); dbp = join(tmp, "t.db"); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("upserts a running row and refreshes it without duplicating", () => {
    const db = openDb(dbp);
    upsertLive(db, inst({ sessionId: "a", status: "waiting" }), 1000);
    upsertLive(db, inst({ sessionId: "a", status: "thinking" }), 2000);
    const rows = listLive(db, { endedSince: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: "a", status: "thinking", lastSeen: 2000, firstSeen: 1000, endedAt: null });
  });

  it("overwrites started_at on the same session id (pid reuse) — still one row", () => {
    const db = openDb(dbp);
    upsertLive(db, inst({ sessionId: "a", startedAt: 100 }), 1000);
    upsertLive(db, inst({ sessionId: "a", startedAt: 200 }), 2000);
    const rows = listLive(db, { endedSince: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startedAt).toBe(200);
  });

  it("markEnded sets ended_at + reason and re-upsert clears it (came back)", () => {
    const db = openDb(dbp);
    upsertLive(db, inst({ sessionId: "a" }), 1000);
    markEnded(db, "a", 3000, "exited");
    let rows = listLive(db, { endedSince: 0 });
    expect(rows[0]).toMatchObject({ endedAt: 3000, endedReason: "exited" });
    upsertLive(db, inst({ sessionId: "a" }), 4000);
    rows = listLive(db, { endedSince: 0 });
    expect(rows[0]).toMatchObject({ endedAt: null, endedReason: null, lastSeen: 4000 });
  });

  it("listLive orders running first, then ended by recency, and honours endedSince", () => {
    const db = openDb(dbp);
    upsertLive(db, inst({ sessionId: "run", status: "x" }), 5000);
    upsertLive(db, inst({ sessionId: "old" }), 1000); markEnded(db, "old", 1500, "exited");
    upsertLive(db, inst({ sessionId: "new" }), 2000); markEnded(db, "new", 9000, "restart");
    const rows = listLive(db, { endedSince: 2000 });
    expect(rows.map((r) => r.sessionId)).toEqual(["run", "new"]);
    expect(rows[0]!.endedAt).toBeNull();
  });

  it("indexedSessionIds returns the subset present in the sessions table", () => {
    const db = openDb(dbp);
    db.prepare("INSERT INTO sessions (id, project_dir, project_label, file_path, file_mtime, file_size, indexed_at) VALUES (?,?,?,?,?,?,?)")
      .run("a", "/p", "p", "/p/a.jsonl", 0, 0, 0);
    expect([...indexedSessionIds(db, ["a", "b"])]).toEqual(["a"]);
  });
});
