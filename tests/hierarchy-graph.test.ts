import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { upsertWorkdir } from "../src/db/workdirs.js";
import { replaceTopics } from "../src/db/topics.js";
import { getHierarchyGraphData } from "../src/db/hierarchy-graph.js";
import type { Session } from "../src/types.js";
import type { WorkdirRecord } from "../src/db/workdirs.js";

function session(id: string, cwd: string | null): Session {
  return {
    id, projectDir: "/p", projectLabel: "p", filePath: `/p/${id}.jsonl`,
    fileMtime: 1, fileSize: 1, startedAt: 1, lastActivity: 1, gitBranch: null,
    messageCount: 3, userMsgCount: 1, compactCount: 0, firstPrompt: "hi",
    aiTitle: null, cwd, indexedAt: 1,
  };
}
function wd(path: string, p: Partial<WorkdirRecord> = {}): WorkdirRecord {
  return {
    path, kind: "git", remote: null, manifestName: null, rootCommit: null,
    existsOnDisk: true, tokens: [], resolvedAt: 1, ...p,
  };
}

describe("getHierarchyGraphData", () => {
  let tmp: string;
  let dbPath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-hg-"));
    dbPath = join(tmp, "test.db");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("without includeTopics, equals the base repo→workdir→session graph (no topic nodes)", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/repo-a", { tokens: ["a"], remote: "github.com/o/a" }));
    upsertSession(db, session("s1", "/repo-a"));
    replaceTopics(db, [{ name: "Backend", sessionIds: ["s1"] }]);

    const { nodes, links } = getHierarchyGraphData(db);
    expect(nodes.filter((n) => n.type === "topic")).toHaveLength(0);
    expect(links.filter((l) => l.kind === "session-topic")).toHaveLength(0);
    expect(nodes.filter((n) => n.type === "repo")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "workdir")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "session")).toHaveLength(1);
  });

  it("with includeTopics, adds topic nodes and session→topic links", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/repo-a", { tokens: ["a"] }));
    upsertSession(db, session("s1", "/repo-a"));
    replaceTopics(db, [{ name: "Backend", sessionIds: ["s1"] }]);

    const { nodes, links } = getHierarchyGraphData(db, { includeTopics: true });
    const topicNodes = nodes.filter((n) => n.type === "topic");
    expect(topicNodes).toHaveLength(1);
    expect(topicNodes[0]!.label).toBe("Backend");
    expect(topicNodes[0]!.sessionCount).toBe(1);
    const st = links.filter((l) => l.kind === "session-topic");
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ source: "sess:s1", target: `topic:${topicNodes[0]!.id.slice(6)}` });
  });

  it("a topic spanning sessions in different workdirs becomes one cross-cutting connector", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/repo-a", { tokens: ["a"], remote: "github.com/o/a" }));
    upsertWorkdir(db, wd("/repo-b", { tokens: ["b"], remote: "github.com/o/b" }));
    upsertSession(db, session("s1", "/repo-a"));
    upsertSession(db, session("s2", "/repo-b"));
    replaceTopics(db, [{ name: "Shared", sessionIds: ["s1", "s2"] }]);

    const { nodes, links } = getHierarchyGraphData(db, { includeTopics: true });
    const topicNodes = nodes.filter((n) => n.type === "topic");
    expect(topicNodes).toHaveLength(1); // ONE topic node, not one per workdir
    expect(topicNodes[0]!.sessionCount).toBe(2);
    // both sessions (which live under different repos) link to that single topic
    const st = links.filter((l) => l.kind === "session-topic");
    expect(st).toHaveLength(2);
    expect(new Set(st.map((l) => l.target)).size).toBe(1);
  });

  it("omits a topic whose only members are sessions not present in the repo graph", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/repo-a", { tokens: ["a"] }));
    upsertSession(db, session("s1", "/repo-a"));
    // "ghost" references a session id that has no node (e.g. no cwd → not placed)
    replaceTopics(db, [
      { name: "Real", sessionIds: ["s1"] },
      { name: "Ghost", sessionIds: ["nope"] },
    ]);

    const { nodes } = getHierarchyGraphData(db, { includeTopics: true });
    const topicNames = nodes.filter((n) => n.type === "topic").map((n) => n.label);
    expect(topicNames).toEqual(["Real"]);
  });
});
