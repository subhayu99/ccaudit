import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { getHistorySpan } from "../src/db/analytics.js";
import type { Session } from "../src/types.js";

const day = (y: number, mo: number, d: number, h = 9) => new Date(y, mo, d, h, 0, 0).getTime();
function sess(id: string, lastActivity: number | null): Session {
  return {
    id, projectDir: "/p", projectLabel: "p", filePath: `/p/${id}.jsonl`,
    fileMtime: 1, fileSize: 1, startedAt: lastActivity, lastActivity, gitBranch: null,
    messageCount: 5, userMsgCount: 2, compactCount: 0, firstPrompt: "x", aiTitle: null,
    cwd: "/p", indexedAt: 1,
  };
}

describe("getHistorySpan", () => {
  let tmp: string, dbPath: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-span-")); dbPath = join(tmp, "t.db"); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns nulls and 0 active days for an empty index", () => {
    const db = openDb(dbPath);
    expect(getHistorySpan(db)).toEqual({ firstActivity: null, lastActivity: null, activeDays: 0 });
  });

  it("returns first/last activity and the count of distinct active days", () => {
    const db = openDb(dbPath);
    upsertSession(db, sess("a", day(2026, 4, 1, 9)));
    upsertSession(db, sess("b", day(2026, 4, 1, 15))); // same calendar day as a
    upsertSession(db, sess("c", day(2026, 4, 10, 9)));
    const span = getHistorySpan(db);
    expect(span.firstActivity).toBe(day(2026, 4, 1, 9));
    expect(span.lastActivity).toBe(day(2026, 4, 10, 9));
    expect(span.activeDays).toBe(2); // May 1 and May 10
  });
});
