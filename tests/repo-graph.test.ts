import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { upsertWorkdir } from "../src/db/workdirs.js";
import { getRepoGraphData } from "../src/db/repo-graph.js";
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

describe("getRepoGraphData", () => {
  let tmp: string;
  let dbPath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-rg-"));
    dbPath = join(tmp, "test.db");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("pivots Repo → Workdir → Session for two clones of one repo", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/clone-a", { tokens: ["root", "a"], remote: "github.com/o/backend" }));
    upsertWorkdir(db, wd("/clone-b", { tokens: ["root", "b"], remote: "github.com/o/backend" }));
    upsertSession(db, session("s1", "/clone-a"));
    upsertSession(db, session("s2", "/clone-b"));

    const { nodes, links } = getRepoGraphData(db);
    const repoNodes = nodes.filter((n) => n.type === "repo");
    const workdirNodes = nodes.filter((n) => n.type === "workdir");
    const sessionNodes = nodes.filter((n) => n.type === "session");

    expect(repoNodes).toHaveLength(1); // two clones → one repo
    expect(repoNodes[0]!.label).toBe("backend");
    expect(workdirNodes).toHaveLength(2);
    expect(sessionNodes).toHaveLength(2);

    // both workdirs link to the same repo node
    const wToRepo = links.filter((l) => l.kind === "workdir-repo");
    expect(wToRepo).toHaveLength(2);
    expect(new Set(wToRepo.map((l) => l.target)).size).toBe(1);

    // each session links to its workdir
    const sToW = links.filter((l) => l.kind === "session-workdir");
    expect(sToW).toHaveLength(2);
  });

  it("labels a workdir node by its path basename and carries existsOnDisk", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/conductor/workspaces/backend/delhi", { tokens: ["c"], existsOnDisk: false }));
    upsertSession(db, session("s1", "/conductor/workspaces/backend/delhi"));
    const wnode = getRepoGraphData(db).nodes.find((n) => n.type === "workdir")!;
    expect(wnode.label).toBe("delhi");
    expect(wnode.existsOnDisk).toBe(false);
  });

  it("session node carries its exact cwd (for the resume command)", () => {
    const db = openDb(dbPath);
    upsertWorkdir(db, wd("/repo", { tokens: ["c"] }));
    upsertSession(db, session("s1", "/repo"));
    const snode = getRepoGraphData(db).nodes.find((n) => n.type === "session")!;
    expect(snode.cwd).toBe("/repo");
  });

  it("omits sessions with no cwd (cannot be placed in a repo)", () => {
    const db = openDb(dbPath);
    upsertSession(db, session("s1", null));
    const { nodes } = getRepoGraphData(db);
    expect(nodes.filter((n) => n.type === "session")).toHaveLength(0);
  });
});
