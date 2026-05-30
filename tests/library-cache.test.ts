import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { upsertWorkdir } from "../src/db/workdirs.js";
import { addExclusion, removeExclusion } from "../src/db/exclusions.js";
import { getLibraryTree } from "../src/db/library.js";
import type { Session } from "../src/types.js";
import type { WorkdirRecord } from "../src/db/workdirs.js";

function sess(id: string, cwd: string, title: string, lastActivity = 1): Session {
  return {
    id, projectDir: cwd, projectLabel: cwd, filePath: `/p/${id}.jsonl`,
    fileMtime: 1, fileSize: 1, startedAt: 1, lastActivity, gitBranch: null,
    messageCount: 5, userMsgCount: 2, compactCount: 0, firstPrompt: title,
    aiTitle: null, cwd, indexedAt: 1,
  };
}
function wd(path: string, tokens: string[], p: Partial<WorkdirRecord> = {}): WorkdirRecord {
  return { path, kind: "git", remote: null, manifestName: null, rootCommit: null,
    existsOnDisk: true, tokens, resolvedAt: 1, ...p };
}

describe("getLibraryTree memoization", () => {
  let tmp: string, db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-libcache-"));
    db = openDb(join(tmp, "t.db"));
    upsertWorkdir(db, wd("/w/delhi", ["root", "a"], { remote: "github.com/o/backend" }));
    upsertSession(db, sess("s1", "/w/delhi", "fix login"));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns the same cached tree object on a second call (cache hit)", () => {
    const a = getLibraryTree(db);
    const b = getLibraryTree(db);
    expect(b).toBe(a); // object identity proves heavy build was skipped
  });

  it("invalidates the cache after inserting a new session", () => {
    const a = getLibraryTree(db);
    upsertWorkdir(db, wd("/w/tianjin", ["root", "b"], { remote: "github.com/o/backend2" }));
    upsertSession(db, sess("s2", "/w/tianjin", "add retry", 2));
    const b = getLibraryTree(db);
    expect(b).not.toBe(a);
    expect(b.totalCount).toBe(2);
  });

  it("invalidates the cache after adding then removing an exclusion", () => {
    const a = getLibraryTree(db);
    addExclusion(db, "/w/delhi");
    const b = getLibraryTree(db);
    expect(b).not.toBe(a);
    expect(b.totalCount).toBe(0);

    removeExclusion(db, "/w/delhi");
    const c = getLibraryTree(db);
    expect(c).not.toBe(b);
    expect(c.totalCount).toBe(1);
  });

  it("does not share a cache across two different DB connections", () => {
    const tree1 = getLibraryTree(db);

    const tmp2 = mkdtempSync(join(tmpdir(), "ccaudit-libcache2-"));
    const db2 = openDb(join(tmp2, "t.db"));
    upsertWorkdir(db2, wd("/w/delhi", ["root", "a"], { remote: "github.com/o/backend" }));
    upsertSession(db2, sess("s1", "/w/delhi", "fix login"));
    upsertSession(db2, sess("s9", "/w/delhi", "extra", 3));
    const tree2 = getLibraryTree(db2);

    expect(tree2).not.toBe(tree1);
    expect(tree1.totalCount).toBe(1);
    expect(tree2.totalCount).toBe(2);

    db2.close();
    rmSync(tmp2, { recursive: true, force: true });
  });
});
