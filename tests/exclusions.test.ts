import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import {
  addExclusion,
  removeExclusion,
  listExclusions,
  isExcludedPath,
  exclusionCondition,
} from "../src/db/exclusions.js";
import type { Session } from "../src/types.js";

function session(id: string, projectDir: string): Session {
  return {
    id, projectDir, projectLabel: projectDir, filePath: `/p/${id}.jsonl`,
    fileMtime: 1, fileSize: 1, startedAt: 1, lastActivity: 1, gitBranch: null,
    messageCount: 0, userMsgCount: 0, compactCount: 0, firstPrompt: null,
    aiTitle: null, cwd: projectDir, indexedAt: 1,
  };
}

describe("isExcludedPath (pure)", () => {
  it("matches an exact prefix and anything under it", () => {
    const ex = ["/Users/me/.claude-mem/observer/sessions"];
    expect(isExcludedPath("/Users/me/.claude-mem/observer/sessions", ex)).toBe(true);
    expect(isExcludedPath("/Users/me/.claude-mem/observer/sessions/abc", ex)).toBe(true);
  });
  it("does NOT match a sibling that merely shares the prefix string", () => {
    expect(isExcludedPath("/a/backend-2", ["/a/backend"])).toBe(false);
    expect(isExcludedPath("/a/back", ["/a/backend"])).toBe(false);
  });
  it("returns false when there are no exclusions", () => {
    expect(isExcludedPath("/anything", [])).toBe(false);
  });
});

describe("db/exclusions", () => {
  let tmp: string;
  let dbPath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-ex-"));
    dbPath = join(tmp, "test.db");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("adds, lists, and removes exclusions", () => {
    const db = openDb(dbPath);
    addExclusion(db, "/a/obs");
    addExclusion(db, "/a/obs"); // idempotent
    addExclusion(db, "/b/other");
    expect(listExclusions(db).sort()).toEqual(["/a/obs", "/b/other"]);
    removeExclusion(db, "/a/obs");
    expect(listExclusions(db)).toEqual(["/b/other"]);
  });

  it("exclusionCondition is '1' (keep all) when nothing is excluded", () => {
    const db = openDb(dbPath);
    expect(exclusionCondition(db).sql).toBe("1");
  });

  it("exclusionCondition filters excluded rows (incl. children, not siblings)", () => {
    const db = openDb(dbPath);
    upsertSession(db, session("keep", "/work/backend"));
    upsertSession(db, session("sibling", "/work/backend-2"));
    upsertSession(db, session("child", "/work/observer/sessions/x"));
    upsertSession(db, session("obs", "/work/observer/sessions"));
    addExclusion(db, "/work/observer/sessions");

    const ex = exclusionCondition(db);
    const ids = (
      db.prepare(`SELECT id FROM sessions WHERE ${ex.sql} ORDER BY id`).all(ex.params) as Array<{
        id: string;
      }>
    ).map((r) => r.id);
    expect(ids.sort()).toEqual(["keep", "sibling"]); // obs + child excluded, sibling kept
  });
});
