import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { listLive } from "../src/db/live-sessions.js";
import { runWatchTick } from "../src/watch/tick.js";
import type { LiveInstance } from "../src/watch/registry.js";

const inst = (sessionId: string, over: Partial<LiveInstance> = {}): LiveInstance => ({
  pid: 1, sessionId, cwd: "/w", name: sessionId, status: "waiting", waitingFor: null, version: "2.1", startedAt: 1, updatedAt: 1, ...over,
});

describe("runWatchTick", () => {
  let tmp: string, dbp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-tick-")); dbp = join(tmp, "t.db"); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("marks a vanished session 'exited' when it disappeared after boot", () => {
    const db = openDb(dbp);
    runWatchTick(db, { now: 1000, bootTime: 0, registry: () => [inst("a"), inst("b")] });
    const summary = runWatchTick(db, { now: 2000, bootTime: 0, registry: () => [inst("a")] });
    expect(summary).toEqual({ running: 1, endedNow: 1 });
    const rows = listLive(db, { endedSince: 0 });
    const b = rows.find((r) => r.sessionId === "b")!;
    expect(b).toMatchObject({ endedAt: 2000, endedReason: "exited" });
    expect(rows.find((r) => r.sessionId === "a")!.endedAt).toBeNull();
  });

  it("classifies sessions last seen before boot as 'restart'", () => {
    const db = openDb(dbp);
    runWatchTick(db, { now: 1000, bootTime: 5000, registry: () => [inst("a")] });
    runWatchTick(db, { now: 6000, bootTime: 5000, registry: () => [] });
    const rows = listLive(db, { endedSince: 0 });
    expect(rows[0]).toMatchObject({ sessionId: "a", endedReason: "restart" });
  });

  it("does not duplicate rows or re-end already-ended sessions", () => {
    const db = openDb(dbp);
    runWatchTick(db, { now: 1000, bootTime: 0, registry: () => [inst("a")] });
    runWatchTick(db, { now: 2000, bootTime: 0, registry: () => [] });
    const s = runWatchTick(db, { now: 3000, bootTime: 0, registry: () => [] });
    expect(s.endedNow).toBe(0);
    const rows = listLive(db, { endedSince: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endedAt).toBe(2000);
  });

  it("overwrites started_at on pid reuse without creating a second row", () => {
    const db = openDb(dbp);
    runWatchTick(db, { now: 1000, bootTime: 0, registry: () => [inst("a", { startedAt: 1 })] });
    runWatchTick(db, { now: 2000, bootTime: 0, registry: () => [inst("a", { startedAt: 2 })] });
    const rows = listLive(db, { endedSince: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startedAt).toBe(2);
  });
});
