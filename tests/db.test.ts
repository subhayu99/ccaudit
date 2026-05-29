import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession, getSession, listSessions, listProjects } from "../src/db/sessions.js";
import type { Session } from "../src/types.js";
import {
  insertMessages,
  deleteSessionMessages,
  getSessionMessages,
  searchMessages,
} from "../src/db/messages.js";
import type { MessageRow } from "../src/types.js";
import { addTag, removeTag, getSessionTags, getSessionsByTag } from "../src/db/tags.js";
import { getGraphData } from "../src/db/graph.js";
import { getIndexStats } from "../src/db/stats.js";
import { getActivityByDay, getToolUsage } from "../src/db/analytics.js";

describe("db/init", () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    dbPath = join(tmp, "test.db");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates the sessions, messages, tags, exports tables and the FTS5 vtable", () => {
    const db = openDb(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual') ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "sessions",
        "messages",
        "messages_fts",
        "session_tags",
        "session_exports",
      ])
    );
    db.close();
  });

  it("creates the three FTS5 sync triggers on the messages table", () => {
    const db = openDb(dbPath);
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = triggers.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "messages_ai", // after insert
        "messages_ad", // after delete
        "messages_au", // after update
      ])
    );
    db.close();
  });
});

describe("db/sessions", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const fixture = (overrides: Partial<Session> = {}): Session => ({
    id: "sess-1",
    projectDir: "/Users/x/proj",
    projectLabel: "x/proj",
    filePath: "/tmp/sess-1.jsonl",
    fileMtime: 1000,
    fileSize: 42,
    startedAt: 900,
    lastActivity: 950,
    gitBranch: "main",
    messageCount: 5,
    userMsgCount: 2,
    compactCount: 0,
    firstPrompt: "hello",
    aiTitle: null,
    cwd: "/Users/x/proj",
    indexedAt: 1100,
    ...overrides,
  });

  it("upserts and retrieves a session", () => {
    upsertSession(db, fixture());
    const got = getSession(db, "sess-1");
    expect(got).not.toBeNull();
    expect(got!.projectLabel).toBe("x/proj");
    expect(got!.messageCount).toBe(5);
  });

  it("upsert replaces existing row", () => {
    upsertSession(db, fixture());
    upsertSession(db, fixture({ messageCount: 99 }));
    expect(getSession(db, "sess-1")!.messageCount).toBe(99);
  });

  it("listSessions orders by last_activity desc and applies limit/offset", () => {
    upsertSession(db, fixture({ id: "a", lastActivity: 100 }));
    upsertSession(db, fixture({ id: "b", lastActivity: 200 }));
    upsertSession(db, fixture({ id: "c", lastActivity: 150 }));
    const rows = listSessions(db, { limit: 10, offset: 0 });
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("listSessions filters by project_dir", () => {
    upsertSession(db, fixture({ id: "a", projectDir: "/p1" }));
    upsertSession(db, fixture({ id: "b", projectDir: "/p2" }));
    const rows = listSessions(db, { projectDir: "/p1" });
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("listProjects groups sessions by project_dir with counts and last activity", () => {
    upsertSession(db, fixture({ id: "a", projectDir: "/p1", projectLabel: "p1", lastActivity: 100 }));
    upsertSession(db, fixture({ id: "b", projectDir: "/p1", projectLabel: "p1", lastActivity: 200 }));
    upsertSession(db, fixture({ id: "c", projectDir: "/p2", projectLabel: "p2", lastActivity: 150 }));
    const projs = listProjects(db);
    expect(projs).toHaveLength(2);
    expect(projs[0]!.projectDir).toBe("/p1");
    expect(projs[0]!.sessionCount).toBe(2);
    expect(projs[0]!.lastActivity).toBe(200);
    expect(projs[1]!.projectDir).toBe("/p2");
  });

  it("stores and retrieves cwd", () => {
    upsertSession(db, fixture({ cwd: "/home/user/my-project" }));
    expect(getSession(db, "sess-1")!.cwd).toBe("/home/user/my-project");
  });
});

describe("db/messages", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
    upsertSession(db, {
      id: "s1",
      projectDir: "/p",
      projectLabel: "p",
      filePath: "/p/s1.jsonl",
      fileMtime: 0,
      fileSize: 0,
      startedAt: null,
      lastActivity: null,
      gitBranch: null,
      messageCount: 0,
      userMsgCount: 0,
      compactCount: 0,
      firstPrompt: null,
      aiTitle: null,
      cwd: null,
      indexedAt: 0,
    });
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const msg = (overrides: Partial<MessageRow>): MessageRow => ({
    sessionId: "s1",
    lineNo: 1,
    uuid: null,
    parentUuid: null,
    type: "user",
    role: "user",
    isSidechain: false,
    isCompactSummary: false,
    timestamp: null,
    textContent: "hello world",
    rawJson: "{}",
    ...overrides,
  });

  it("inserts and retrieves messages in line order", () => {
    insertMessages(db, [msg({ lineNo: 2, textContent: "second" }), msg({ lineNo: 1, textContent: "first" })]);
    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.lineNo)).toEqual([1, 2]);
    expect(rows[0]!.textContent).toBe("first");
  });

  it("deleteSessionMessages removes all rows for a session", () => {
    insertMessages(db, [msg({ lineNo: 1 }), msg({ lineNo: 2 })]);
    deleteSessionMessages(db, "s1");
    expect(getSessionMessages(db, "s1")).toEqual([]);
  });

  it("FTS5 search returns messages matching the query", () => {
    insertMessages(db, [
      msg({ lineNo: 1, textContent: "the quick brown fox" }),
      msg({ lineNo: 2, textContent: "lazy dog jumps" }),
    ]);
    const hits = searchMessages(db, "fox");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sessionId).toBe("s1");
    expect(hits[0]!.lineNo).toBe(1);
    expect(hits[0]!.snippet).toContain("fox");
  });

  it("FTS5 search applies porter stemming", () => {
    insertMessages(db, [msg({ lineNo: 1, textContent: "the dogs were running" })]);
    const hits = searchMessages(db, "dog");
    expect(hits).toHaveLength(1);
  });
});

describe("db/tags", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
    for (const id of ["s1", "s2"]) {
      upsertSession(db, {
        id, projectDir: "/p", projectLabel: "p", filePath: `/p/${id}.jsonl`,
        fileMtime: 0, fileSize: 0, startedAt: null, lastActivity: null,
        gitBranch: null, messageCount: 0, userMsgCount: 0, compactCount: 0,
        firstPrompt: null, aiTitle: null, cwd: null, indexedAt: 0,
      });
    }
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it("adds and lists tags for a session", () => {
    addTag(db, "s1", "Audit", Date.now());
    addTag(db, "s1", "ops", Date.now());
    expect(getSessionTags(db, "s1").sort()).toEqual(["Audit", "ops"]);
  });

  it("addTag is idempotent (same case)", () => {
    addTag(db, "s1", "ops", Date.now());
    addTag(db, "s1", "ops", Date.now());
    expect(getSessionTags(db, "s1")).toEqual(["ops"]);
  });

  it("getSessionsByTag is case-insensitive but display case is preserved", () => {
    addTag(db, "s1", "Audit", Date.now());
    addTag(db, "s2", "audit", Date.now());
    const hits = getSessionsByTag(db, "AUDIT");
    expect(hits.sort()).toEqual(["s1", "s2"]);
  });

  it("removeTag removes only the matching tag", () => {
    addTag(db, "s1", "ops", Date.now());
    addTag(db, "s1", "Audit", Date.now());
    removeTag(db, "s1", "ops");
    expect(getSessionTags(db, "s1")).toEqual(["Audit"]);
  });
});

describe("db/stats", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns aggregate stats across all sessions", () => {
    const s = (id: string, msgs: number, compacts: number, start: number, end: number) => ({
      id, projectDir: "/p", projectLabel: "p", filePath: `/p/${id}.jsonl`,
      fileMtime: 0, fileSize: 0, startedAt: start, lastActivity: end,
      gitBranch: null, messageCount: msgs, userMsgCount: 0,
      compactCount: compacts, firstPrompt: null, aiTitle: null, cwd: null, indexedAt: 0,
    });
    upsertSession(db, s("a", 100, 0, 1000, 2000));
    upsertSession(db, s("b", 200, 2, 500, 3000));
    upsertSession(db, s("c", 50, 1, 1500, 2500));

    const stats = getIndexStats(db);
    expect(stats.totalSessions).toBe(3);
    expect(stats.totalMessages).toBe(350);
    expect(stats.sessionsWithCompacts).toBe(2);
    expect(stats.oldestSession).toBe(500);
    expect(stats.newestSession).toBe(3000);
  });
});

describe("db/analytics", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  const sess = (id: string, lastActivity: number, msgs: number): Session => ({
    id, projectDir: "/p", projectLabel: "p", filePath: `/p/${id}.jsonl`,
    fileMtime: 0, fileSize: 0, startedAt: lastActivity, lastActivity,
    gitBranch: null, messageCount: msgs, userMsgCount: 0, compactCount: 0,
    firstPrompt: null, aiTitle: null, cwd: null, indexedAt: 0,
  });

  it("getActivityByDay groups sessions by local calendar day", () => {
    // 2026-05-23T10:00:00Z and 2026-05-23T20:00:00Z -> same or adjacent local day
    const may23 = Date.parse("2026-05-23T10:00:00Z");
    upsertSession(db, sess("a", may23, 100));
    upsertSession(db, sess("b", may23 + 3600_000, 50));
    const activity = getActivityByDay(db);
    expect(activity.length).toBeGreaterThanOrEqual(1);
    const total = activity.reduce((s, d) => s + d.sessions, 0);
    expect(total).toBe(2);
    const totalMsgs = activity.reduce((s, d) => s + d.messages, 0);
    expect(totalMsgs).toBe(150);
  });

  it("getToolUsage counts tool_use blocks by name across assistant messages", () => {
    upsertSession(db, sess("s1", 1000, 0));
    insertMessages(db, [
      { sessionId: "s1", lineNo: 1, uuid: null, parentUuid: null, type: "assistant", role: "assistant",
        isSidechain: false, isCompactSummary: false, timestamp: null, textContent: null,
        rawJson: JSON.stringify({ message: { content: [{ type: "tool_use", name: "Bash" }, { type: "tool_use", name: "Read" }] } }) },
      { sessionId: "s1", lineNo: 2, uuid: null, parentUuid: null, type: "assistant", role: "assistant",
        isSidechain: false, isCompactSummary: false, timestamp: null, textContent: null,
        rawJson: JSON.stringify({ message: { content: [{ type: "tool_use", name: "Bash" }] } }) },
      { sessionId: "s1", lineNo: 3, uuid: null, parentUuid: null, type: "user", role: "user",
        isSidechain: false, isCompactSummary: false, timestamp: null, textContent: "hi", rawJson: "{}" },
    ]);
    const usage = getToolUsage(db);
    const bash = usage.find((u) => u.tool === "Bash");
    const read = usage.find((u) => u.tool === "Read");
    expect(bash!.count).toBe(2);
    expect(read!.count).toBe(1);
    // sorted desc
    expect(usage[0]!.tool).toBe("Bash");
  });
});

describe("db/graph", () => {
  let tmp: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-test-"));
    db = openDb(join(tmp, "test.db"));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const s = (id: string, projectDir: string, projectLabel: string): Session => ({
    id, projectDir, projectLabel, filePath: `/p/${id}.jsonl`,
    fileMtime: 0, fileSize: 0, startedAt: 0, lastActivity: 0,
    gitBranch: null, messageCount: 10, userMsgCount: 0, compactCount: 0,
    firstPrompt: "hello world", aiTitle: null, cwd: null, indexedAt: 0,
  });

  it("builds project hubs + session nodes with session->project links", () => {
    upsertSession(db, s("a", "/p1", "p1"));
    upsertSession(db, s("b", "/p1", "p1"));
    upsertSession(db, s("c", "/p2", "p2"));

    const g = getGraphData(db);
    const projectNodes = g.nodes.filter((n) => n.type === "project");
    const sessionNodes = g.nodes.filter((n) => n.type === "session");
    const spLinks = g.links.filter((l) => l.kind === "session-project");

    expect(projectNodes).toHaveLength(2);
    expect(sessionNodes).toHaveLength(3);
    expect(spLinks).toHaveLength(3);

    // p1 project node has sessionCount 2
    const p1 = projectNodes.find((n) => n.projectDir === "/p1");
    expect(p1!.sessionCount).toBe(2);

    // every session-project link points from a session to its project
    for (const link of spLinks) {
      expect(link.source.startsWith("sess:")).toBe(true);
      expect(link.target.startsWith("proj:")).toBe(true);
    }

    // session 'a' links to proj /p1
    const aLink = spLinks.find((l) => l.source === "sess:a");
    expect(aLink!.target).toBe("proj:/p1");
  });

  it("creates folder nodes only for parents shared by >=2 projects", () => {
    // Two projects under the same parent /work/repo -> one folder node
    upsertSession(db, s("a", "/work/repo/alpha", "repo/alpha"));
    upsertSession(db, s("b", "/work/repo/beta", "repo/beta"));
    // A project with a unique parent -> no folder node
    upsertSession(db, s("c", "/solo/only", "solo/only"));

    const g = getGraphData(db);
    const folderNodes = g.nodes.filter((n) => n.type === "folder");
    expect(folderNodes).toHaveLength(1);
    expect(folderNodes[0]!.folderPath).toBe("/work/repo");
    expect(folderNodes[0]!.projectCount).toBe(2);

    // project-folder links connect the two repo projects to the folder
    const pfLinks = g.links.filter((l) => l.kind === "project-folder");
    expect(pfLinks).toHaveLength(2);
    expect(pfLinks.every((l) => l.target === "folder:/work/repo")).toBe(true);
  });

  it("creates continuation links between consecutive sessions in a project, by time", () => {
    upsertSession(db, { ...s("first", "/p", "p"), startedAt: 100 });
    upsertSession(db, { ...s("second", "/p", "p"), startedAt: 200 });
    upsertSession(db, { ...s("third", "/p", "p"), startedAt: 300 });
    // a lone session in another project -> no continuation
    upsertSession(db, { ...s("lone", "/q", "q"), startedAt: 50 });

    const g = getGraphData(db);
    const contLinks = g.links.filter((l) => l.kind === "continuation");
    expect(contLinks).toHaveLength(2); // first->second, second->third
    expect(contLinks[0]).toEqual({ source: "sess:first", target: "sess:second", kind: "continuation" });
    expect(contLinks[1]).toEqual({ source: "sess:second", target: "sess:third", kind: "continuation" });
  });

  it("uses ai_title or first_prompt as session label, falling back to id prefix", () => {
    const withTitle = { ...s("x", "/p", "p"), aiTitle: "My Title" };
    upsertSession(db, withTitle);
    const g = getGraphData(db);
    const node = g.nodes.find((n) => n.sessionId === "x");
    expect(node!.label).toBe("My Title");
  });
});
