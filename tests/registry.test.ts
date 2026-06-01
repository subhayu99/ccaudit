import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLiveRegistry } from "../src/watch/registry.js";

describe("readLiveRegistry", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ccaudit-reg-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (pid: number, obj: Record<string, unknown>) =>
    writeFileSync(join(dir, `${pid}.json`), JSON.stringify(obj));

  it("returns parsed live instances and maps the fields", () => {
    write(100, { pid: 100, sessionId: "s-a", cwd: "/work/a", name: "alpha", status: "waiting", waitingFor: "permission prompt", version: "2.1.154", startedAt: 111, updatedAt: 222 });
    const live = readLiveRegistry({ dir, isAlive: () => true });
    expect(live).toHaveLength(1);
    expect(live[0]!).toMatchObject({ pid: 100, sessionId: "s-a", cwd: "/work/a", name: "alpha", status: "waiting", version: "2.1.154", startedAt: 111, updatedAt: 222 });
  });

  it("drops entries whose pid is not alive", () => {
    write(100, { pid: 100, sessionId: "s-a" });
    write(200, { pid: 200, sessionId: "s-b" });
    const live = readLiveRegistry({ dir, isAlive: (pid) => pid === 100 });
    expect(live.map((l) => l.sessionId)).toEqual(["s-a"]);
  });

  it("skips malformed files without throwing", () => {
    writeFileSync(join(dir, "300.json"), "{ not json");
    write(100, { pid: 100, sessionId: "s-a" });
    const live = readLiveRegistry({ dir, isAlive: () => true });
    expect(live.map((l) => l.sessionId)).toEqual(["s-a"]);
  });

  it("skips entries missing a sessionId or pid", () => {
    write(100, { pid: 100 });
    writeFileSync(join(dir, "x.json"), JSON.stringify({ sessionId: "s-b" }));
    expect(readLiveRegistry({ dir, isAlive: () => true })).toEqual([]);
  });

  it("returns [] when the directory does not exist", () => {
    expect(readLiveRegistry({ dir: join(dir, "nope"), isAlive: () => true })).toEqual([]);
  });

  // PID-reuse-across-reboot guard (PoC-validated)
  it("drops entries whose startedAt predates bootTime (stale pre-reboot files)", () => {
    write(100, { pid: 100, sessionId: "before", startedAt: 500 });
    write(200, { pid: 200, sessionId: "after", startedAt: 1500 });
    const live = readLiveRegistry({ dir, isAlive: () => true, bootTime: 1000 });
    expect(live.map((l) => l.sessionId)).toEqual(["after"]);
  });

  it("keeps entries with a null/unknown startedAt even when bootTime is set", () => {
    writeFileSync(join(dir, "300.json"), JSON.stringify({ pid: 300, sessionId: "unknown" }));
    const live = readLiveRegistry({ dir, isAlive: () => true, bootTime: 1000 });
    expect(live.map((l) => l.sessionId)).toEqual(["unknown"]);
  });

  it("skips files whose JSON root is an array, not an object", () => {
    writeFileSync(join(dir, "400.json"), JSON.stringify([{ pid: 400, sessionId: "s-arr" }]));
    write(100, { pid: 100, sessionId: "s-a" });
    expect(readLiveRegistry({ dir, isAlive: () => true }).map((l) => l.sessionId)).toEqual(["s-a"]);
  });

  it("rejects a pid of 0 or negative (would target a process group)", () => {
    write(100, { pid: 0, sessionId: "zero" });
    writeFileSync(join(dir, "neg.json"), JSON.stringify({ pid: -1, sessionId: "neg" }));
    expect(readLiveRegistry({ dir, isAlive: () => true })).toEqual([]);
  });
});
