import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { upsertWorkdir } from "../src/db/workdirs.js";
import { addExclusion } from "../src/db/exclusions.js";
import { dayBucket, getLibraryTree, listSessionsGrouped } from "../src/db/library.js";
import type { Session } from "../src/types.js";
import type { WorkdirRecord } from "../src/db/workdirs.js";

// Fixed "now": 2026-05-29T12:00:00 local
const NOW = new Date(2026, 4, 29, 12, 0, 0).getTime();
const at = (y: number, mo: number, d: number) => new Date(y, mo, d, 9, 0, 0).getTime();

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

describe("dayBucket", () => {
  it("labels same-day as Today and previous day as Yesterday", () => {
    expect(dayBucket(at(2026, 4, 29), NOW)).toBe("Today");
    expect(dayBucket(at(2026, 4, 28), NOW)).toBe("Yesterday");
  });
  it("labels within the last 7 days as Earlier this week, older as Older", () => {
    expect(dayBucket(at(2026, 4, 25), NOW)).toBe("Earlier this week");
    expect(dayBucket(at(2026, 4, 1), NOW)).toBe("Older");
  });
  it("labels a null timestamp as Older", () => {
    expect(dayBucket(null, NOW)).toBe("Older");
  });
});

describe("getLibraryTree", () => {
  let tmp: string, dbPath: string;
  const setup = () => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-lib-")); dbPath = join(tmp, "t.db"); };
  const teardown = () => rmSync(tmp, { recursive: true, force: true });

  it("groups two clones into one repo with their workdirs and sessions", () => {
    setup();
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/w/delhi", ["root", "a"], { remote: "github.com/o/backend" }));
    upsertWorkdir(db, wd("/w/tianjin", ["root", "b"], { remote: "github.com/o/backend" }));
    upsertSession(db, sess("s1", "/w/delhi", "fix login"));
    upsertSession(db, sess("s2", "/w/tianjin", "add retry"));
    const tree = getLibraryTree(db);
    expect(tree.repos).toHaveLength(1);
    expect(tree.repos[0]!.displayName).toBe("backend");
    expect(tree.repos[0]!.sessionCount).toBe(2);
    expect(tree.repos[0]!.workdirs.map((w) => w.label).sort()).toEqual(["delhi", "tianjin"]);
    expect(tree.totalCount).toBe(2);
    teardown();
  });

  it("omits sessions in excluded directories", () => {
    setup();
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/w/keep", ["c1"], { remote: "github.com/o/keep" }));
    upsertWorkdir(db, wd("/obs", ["c2"]));
    upsertSession(db, sess("s1", "/w/keep", "real"));
    upsertSession(db, sess("s2", "/obs", "noise"));
    addExclusion(db, "/obs");
    const tree = getLibraryTree(db);
    expect(tree.repos.flatMap((r) => r.workdirs.map((w) => w.path))).not.toContain("/obs");
    expect(tree.totalCount).toBe(1);
    teardown();
  });
});

describe("listSessionsGrouped", () => {
  const NOW2 = new Date(2026, 4, 29, 12, 0, 0).getTime();
  const day = (mo: number, d: number) => new Date(2026, mo, d, 9, 0, 0).getTime();
  let tmp2: string, dbp2: string;

  it("returns date-grouped items for a repo selection, newest group first", () => {
    tmp2 = mkdtempSync(join(tmpdir(), "ccaudit-grp-")); dbp2 = join(tmp2, "t.db");
    const db = openDb(dbp2);
    upsertWorkdir(db, wd("/w/delhi", ["root"], { remote: "github.com/o/backend" }));
    upsertSession(db, { ...sess("today", "/w/delhi", "today work", day(4, 29)) });
    upsertSession(db, { ...sess("old", "/w/delhi", "old work", day(3, 1)) });
    const repoId = getLibraryTree(db).repos[0]!.repoId;

    const res = listSessionsGrouped(db, { repo: repoId }, NOW2);
    expect(res.header.title).toBe("backend");
    expect(res.groups[0]!.label).toBe("Today");
    expect(res.groups[0]!.items[0]!.id).toBe("today");
    expect(res.groups.at(-1)!.label).toBe("Older");
    rmSync(tmp2, { recursive: true, force: true });
  });

  it("mode 'recent' returns a flat Recent group across repos", () => {
    tmp2 = mkdtempSync(join(tmpdir(), "ccaudit-grp2-")); dbp2 = join(tmp2, "t.db");
    const db = openDb(dbp2);
    upsertWorkdir(db, wd("/w/a", ["x"], { remote: "github.com/o/a" }));
    upsertSession(db, sess("s1", "/w/a", "hello", day(4, 29)));
    const res = listSessionsGrouped(db, { mode: "recent" }, NOW2);
    expect(res.header.title).toBe("Recent");
    expect(res.groups.flatMap((g) => g.items).map((i) => i.id)).toContain("s1");
    rmSync(tmp2, { recursive: true, force: true });
  });
});
