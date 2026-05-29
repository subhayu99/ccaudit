import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertWorkdir, getWorkdir, listWorkdirs } from "../src/db/workdirs.js";
import { computeRepoComponents } from "../src/identity/components.js";
import type { WorkdirRecord } from "../src/db/workdirs.js";

function rec(path: string, partial: Partial<WorkdirRecord> = {}): WorkdirRecord {
  return {
    path,
    kind: "git",
    remote: null,
    manifestName: null,
    rootCommit: null,
    existsOnDisk: true,
    tokens: [],
    resolvedAt: 1000,
    ...partial,
  };
}

describe("db/workdirs", () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-wd-"));
    dbPath = join(tmp, "test.db");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("creates the workdirs and workdir_tokens tables", () => {
    const db = openDb(dbPath);
    const names = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>
    ).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["workdirs", "workdir_tokens"]));
  });

  it("round-trips a workdir record including its token-set", () => {
    const db = openDb(dbPath);
    upsertWorkdir(
      db,
      rec("/a", {
        remote: "github.com/org/repo",
        rootCommit: "r0",
        tokens: ["r0", "c1", "c2"],
      })
    );
    const got = getWorkdir(db, "/a")!;
    expect(got.path).toBe("/a");
    expect(got.kind).toBe("git");
    expect(got.remote).toBe("github.com/org/repo");
    expect(got.rootCommit).toBe("r0");
    expect(got.existsOnDisk).toBe(true);
    expect(got.tokens.sort()).toEqual(["c1", "c2", "r0"]);
  });

  it("replaces tokens on re-upsert (no stale tokens linger)", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, rec("/a", { tokens: ["old1", "old2"] }));
    upsertWorkdir(db, rec("/a", { tokens: ["new1"] }));
    expect(getWorkdir(db, "/a")!.tokens).toEqual(["new1"]);
  });

  it("listWorkdirs returns records consumable by computeRepoComponents", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, rec("/clone1", { tokens: ["root", "a"] }));
    upsertWorkdir(db, rec("/clone2", { tokens: ["root", "b"] }));
    upsertWorkdir(db, rec("/other", { tokens: ["zzz"] }));
    const all = listWorkdirs(db);
    expect(all).toHaveLength(3);
    const { repos } = computeRepoComponents(all);
    // /clone1 and /clone2 share "root" → one repo; /other separate → 2 total
    expect(repos).toHaveLength(2);
  });
});
