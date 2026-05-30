import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db/init.js";
import {
  replaceTopics, listTopics, renameTopic, deleteTopic, mergeTopics, findTopicByName, getTopic,
} from "../src/db/topics.js";

describe("topic management", () => {
  let dir: string, db: ReturnType<typeof openDb>;
  const idOf = (name: string) => listTopics(db).find((t) => t.name === name)!.id;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ccaudit-topic-"));
    db = openDb(join(dir, "t.db"));
    replaceTopics(db, [
      { name: "Auth", sessionIds: ["a", "b"] },
      { name: "Login", sessionIds: ["b", "c"] },
      { name: "Misc", sessionIds: ["d"] },
    ]);
  });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it("renames a topic", () => {
    expect(renameTopic(db, idOf("Auth"), "Authentication")).toBe(true);
    expect(listTopics(db).some((t) => t.name === "Authentication")).toBe(true);
  });

  it("rejects a rename that clashes with another topic (case-insensitive)", () => {
    expect(renameTopic(db, idOf("Auth"), "login")).toBe(false);
    expect(renameTopic(db, idOf("Auth"), "  ")).toBe(false);
  });

  it("merges topics, deduping shared members and dropping the source", () => {
    mergeTopics(db, [idOf("Login")], idOf("Auth"));
    expect(listTopics(db).some((t) => t.name === "Login")).toBe(false);
    const auth = getTopic(db, idOf("Auth"))!;
    expect(auth.sessionIds.sort()).toEqual(["a", "b", "c"]); // b deduped
  });

  it("deletes a topic and its membership", () => {
    const id = idOf("Misc");
    deleteTopic(db, id);
    expect(listTopics(db).some((t) => t.name === "Misc")).toBe(false);
    expect(getTopic(db, id)).toBeNull();
  });

  it("finds another topic by name (case-insensitive), excluding self", () => {
    expect(findTopicByName(db, "LOGIN")?.name).toBe("Login");
    expect(findTopicByName(db, "Auth", idOf("Auth"))).toBeNull(); // excluded self
  });
});
