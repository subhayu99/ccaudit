import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { getWorkdir, listWorkdirs } from "../src/db/workdirs.js";
import { resolveWorkdirs } from "../src/indexer/resolve-workdirs.js";
import { computeRepoComponents } from "../src/identity/components.js";
import type { GitRunner } from "../src/identity/resolve.js";
import type { Session } from "../src/types.js";

function session(id: string, cwd: string | null): Session {
  return {
    id,
    projectDir: "/p",
    projectLabel: "p",
    filePath: `/p/${id}.jsonl`,
    fileMtime: 1,
    fileSize: 1,
    startedAt: 1,
    lastActivity: 1,
    gitBranch: null,
    messageCount: 0,
    userMsgCount: 0,
    compactCount: 0,
    firstPrompt: null,
    aiTitle: null,
    cwd,
    indexedAt: 1,
  };
}

// Fake git: each cwd maps to a rev-list output; missing cwd → not a repo.
function gitFor(byCwd: Record<string, { revList: string; root?: string; remote?: string }>): GitRunner {
  return (args, cwd) => {
    const r = byCwd[cwd];
    if (!r) return null;
    const joined = args.join(" ");
    if (joined.includes("--max-parents=0")) return r.root ?? null;
    if (joined.includes("rev-list")) return r.revList;
    if (joined.includes("remote.origin.url")) return r.remote ?? null;
    return null;
  };
}

describe("resolveWorkdirs", () => {
  let tmp: string;
  let dbPath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-rw-"));
    dbPath = join(tmp, "test.db");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("resolves each distinct session cwd into a workdir record", () => {
    const db = openDb(dbPath);
    upsertSession(db, session("s1", "/clone-a"));
    upsertSession(db, session("s2", "/clone-a")); // same cwd, resolved once
    upsertSession(db, session("s3", "/clone-b"));

    const count = resolveWorkdirs(db, {
      exists: () => true,
      git: gitFor({
        "/clone-a": { revList: "root\nx", root: "root", remote: "https://github.com/o/r.git" },
        "/clone-b": { revList: "root\ny", root: "root", remote: "https://github.com/o/r.git" },
      }),
    });

    expect(count).toBe(2); // two distinct cwds
    expect(getWorkdir(db, "/clone-a")!.remote).toBe("github.com/o/r");
    // both clones share commit "root" → one repo
    expect(computeRepoComponents(listWorkdirs(db)).repos).toHaveLength(1);
  });

  it("records a deleted cwd as kind 'path' with no tokens", () => {
    const db = openDb(dbPath);
    upsertSession(db, session("s1", "/gone"));
    resolveWorkdirs(db, { exists: () => false, git: gitFor({}) });
    const w = getWorkdir(db, "/gone")!;
    expect(w.kind).toBe("path");
    expect(w.existsOnDisk).toBe(false);
    expect(w.tokens).toEqual([]);
  });

  it("skips already-resolved workdirs unless forced", () => {
    const db = openDb(dbPath);
    upsertSession(db, session("s1", "/repo"));
    const git = gitFor({ "/repo": { revList: "c1", root: "c1" } });
    expect(resolveWorkdirs(db, { exists: () => true, git })).toBe(1);
    // second run: already present → skipped
    expect(resolveWorkdirs(db, { exists: () => true, git })).toBe(0);
    // forced: re-resolved
    expect(resolveWorkdirs(db, { exists: () => true, git, force: true })).toBe(1);
  });

  it("ignores sessions with a null cwd", () => {
    const db = openDb(dbPath);
    upsertSession(db, session("s1", null));
    expect(resolveWorkdirs(db, { exists: () => true, git: gitFor({}) })).toBe(0);
    expect(listWorkdirs(db)).toHaveLength(0);
  });
});
