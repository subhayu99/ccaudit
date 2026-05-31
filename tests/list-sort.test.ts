import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { upsertWorkdir } from "../src/db/workdirs.js";
import { listSessionsGrouped } from "../src/db/library.js";
import type { Session } from "../src/types.js";
import type { TokenUsage } from "../src/lib/pricing.js";

const NOW = new Date(2026, 4, 29, 12, 0, 0).getTime();

function sess(id: string, opts: Partial<Session> = {}): Session {
  return {
    id, projectDir: "/w/a", projectLabel: "/w/a", filePath: `/p/${id}.jsonl`,
    fileMtime: 1, fileSize: 1, startedAt: 1, lastActivity: NOW, gitBranch: null,
    messageCount: 5, userMsgCount: 2, compactCount: 0, firstPrompt: id,
    aiTitle: null, cwd: "/w/a", indexedAt: 1, ...opts,
  };
}
const opus = (output: number): TokenUsage => ({
  "claude-opus-4-8": { input: 1000, output, cacheRead: 0, cacheCreation: 0 },
});

describe("listSessionsGrouped — sort", () => {
  let tmp: string, dbPath: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-sort-")); dbPath = join(tmp, "t.db"); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("sort=cost ranks by estimated cost desc in one group, with costUsd populated", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, { path: "/w/a", kind: "git", remote: "github.com/o/a", manifestName: null, rootCommit: null, existsOnDisk: true, tokens: ["c1"], resolvedAt: 1 });
    upsertSession(db, sess("cheap", { tokenUsage: opus(100) }));
    upsertSession(db, sess("pricey", { tokenUsage: opus(100_000) }));
    upsertSession(db, sess("mid", { tokenUsage: opus(5_000) }));

    const list = listSessionsGrouped(db, { mode: "all" }, NOW, undefined, { sort: "cost" });
    expect(list.groups).toHaveLength(1);
    const items = list.groups[0]!.items;
    expect(items.map((i) => i.id)).toEqual(["pricey", "mid", "cheap"]);
    expect(items[0]!.costUsd).toBeGreaterThan(items[2]!.costUsd);
    expect(items[2]!.costUsd).toBeGreaterThan(0);
  });

  it("sort=messages ranks by message count desc in one group", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, { path: "/w/a", kind: "git", remote: "github.com/o/a", manifestName: null, rootCommit: null, existsOnDisk: true, tokens: ["c1"], resolvedAt: 1 });
    upsertSession(db, sess("small", { messageCount: 3 }));
    upsertSession(db, sess("big", { messageCount: 900 }));
    upsertSession(db, sess("med", { messageCount: 50 }));

    const list = listSessionsGrouped(db, { mode: "all" }, NOW, undefined, { sort: "messages" });
    expect(list.groups).toHaveLength(1);
    expect(list.groups[0]!.items.map((i) => i.id)).toEqual(["big", "med", "small"]);
  });

  it("default (time) keeps the day-bucket grouping and populates costUsd", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, { path: "/w/a", kind: "git", remote: "github.com/o/a", manifestName: null, rootCommit: null, existsOnDisk: true, tokens: ["c1"], resolvedAt: 1 });
    upsertSession(db, sess("t1", { lastActivity: new Date(2026, 4, 29, 9).getTime(), tokenUsage: opus(2000) })); // Today
    upsertSession(db, sess("t2", { lastActivity: new Date(2026, 4, 20, 9).getTime() })); // Older

    const list = listSessionsGrouped(db, { mode: "all" }, NOW);
    const labels = list.groups.map((g) => g.label);
    expect(labels).toContain("Today");
    expect(labels).toContain("Older");
    const today = list.groups.find((g) => g.label === "Today")!;
    expect(today.items[0]!.costUsd).toBeGreaterThan(0);
  });
});
