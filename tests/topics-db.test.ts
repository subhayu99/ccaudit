import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { replaceTopics, listTopics, getTopic } from "../src/db/topics.js";

describe("db/topics", () => {
  let tmp: string, dbp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-top-")); dbp = join(tmp, "t.db"); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("replaces topics + members and lists them by size", () => {
    const db = openDb(dbp);
    replaceTopics(db, [
      { name: "Backend", sessionIds: ["a", "b", "c"] },
      { name: "Outreach", sessionIds: ["d"] },
    ]);
    const t = listTopics(db);
    expect(t.map((x) => [x.name, x.sessionCount])).toEqual([["Backend", 3], ["Outreach", 1]]);
    const backend = t.find((x) => x.name === "Backend")!;
    expect(getTopic(db, backend.id)!.sessionIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("re-clustering wipes the previous set", () => {
    const db = openDb(dbp);
    replaceTopics(db, [{ name: "Old", sessionIds: ["a"] }]);
    replaceTopics(db, [{ name: "New", sessionIds: ["b", "c"] }]);
    expect(listTopics(db).map((x) => x.name)).toEqual(["New"]);
  });
});
