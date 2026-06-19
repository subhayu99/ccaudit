import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../db/init.js";
import { upsertSession } from "../db/sessions.js";
import { encodeProjectDir } from "../lib/rehome.js";
import { addRule } from "../db/exclusions.js";
import type { Session } from "../types.js";
import { toolListMismatchedSessions, toolApplySessionMoves } from "./tools.js";

let tmp: string;
let db: Db;
let projectsRoot: string;
let backupDir: string;

/** Insert a session row AND lay down its real .jsonl under the temp projects root. */
function seed(opts: {
  id: string;
  filedDir: string;
  inferredDir?: string | null;
  inferredHits?: number;
  inferredLaunchHits?: number;
  lines?: object[];
}): void {
  const folder = join(projectsRoot, encodeProjectDir(opts.filedDir));
  mkdirSync(folder, { recursive: true });
  const filePath = join(folder, `${opts.id}.jsonl`);
  const lines = opts.lines ?? [{ type: "user", cwd: opts.filedDir, text: "hi" }];
  writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const s: Session = {
    id: opts.id,
    projectDir: opts.filedDir,
    projectLabel: opts.filedDir.split("/").filter(Boolean).slice(-2).join("/"),
    filePath,
    fileMtime: 1,
    fileSize: 1,
    startedAt: 1,
    lastActivity: 1,
    gitBranch: null,
    messageCount: lines.length,
    userMsgCount: 1,
    compactCount: 0,
    firstPrompt: "hi there",
    aiTitle: null,
    cwd: opts.filedDir,
    indexedAt: 1,
    tokenUsage: null,
    inferredDir: opts.inferredDir ?? null,
    inferredHits: opts.inferredHits ?? 0,
    inferredLaunchHits: opts.inferredLaunchHits ?? 0,
  };
  upsertSession(db, s);
}

const noRunning = () => new Set<string>();

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ccaudit-movetools-"));
  db = openDb(join(tmp, "index.db"));
  projectsRoot = join(tmp, "projects");
  backupDir = join(tmp, "backups");
  mkdirSync(projectsRoot, { recursive: true });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("toolListMismatchedSessions", () => {
  it("lists only flagged sessions, biggest evidence margin first, with a running flag", () => {
    seed({ id: "aaa", filedDir: "/x/parent", inferredDir: "/x/work-a", inferredHits: 20, inferredLaunchHits: 2 });
    seed({ id: "bbb", filedDir: "/x/parent", inferredDir: "/x/work-b", inferredHits: 100, inferredLaunchHits: 1 });
    seed({ id: "ccc", filedDir: "/x/ok" }); // filed correctly → inferred_dir NULL → not listed

    const out: any = toolListMismatchedSessions(db, {}, { runningIds: () => new Set(["aaa"]), isProjectRoot: () => true });

    expect(out.count).toBe(2);
    expect(out.sessions[0].sessionId).toBe("bbb"); // (100-1) margin beats (20-2)
    expect(out.sessions[0].inferredDir).toBe("/x/work-b");
    expect(out.sessions.find((s: any) => s.sessionId === "aaa").running).toBe(true);
    expect(out.sessions.find((s: any) => s.sessionId === "ccc")).toBeUndefined();
  });

  it("hides sessions matched by global exclusion filters, unless includeHidden", () => {
    seed({ id: "keep", filedDir: "/x/parent", inferredDir: "/x/work", inferredHits: 30, inferredLaunchHits: 1 });
    seed({ id: "drop", filedDir: "/x/parent", inferredDir: "/x/work", inferredHits: 20, inferredLaunchHits: 1 });
    addRule(db, "session", "drop"); // the user discarded this session earlier

    const def: any = toolListMismatchedSessions(db, {}, { runningIds: noRunning, isProjectRoot: () => true });
    expect(def.count).toBe(1);
    expect(def.sessions.map((s: any) => s.sessionId)).toEqual(["keep"]);
    expect(def.hiddenCount).toBe(1);

    const withHidden: any = toolListMismatchedSessions(db, { includeHidden: true }, { runningIds: noRunning, isProjectRoot: () => true });
    expect(withHidden.count).toBe(2);
    expect(withHidden.sessions.find((s: any) => s.sessionId === "drop").hidden).toBe(true);
    expect(withHidden.sessions.find((s: any) => s.sessionId === "keep").hidden).toBe(false);
  });
});

describe("toolApplySessionMoves", () => {
  it("gates on one-time consent and writes nothing until acknowledged", () => {
    seed({ id: "aaa", filedDir: join(tmp, "parent"), inferredDir: "/x/work", inferredHits: 10 });
    const target = join(tmp, "real-work");
    mkdirSync(target, { recursive: true });

    const out: any = toolApplySessionMoves(
      db,
      { moves: [{ sessionId: "aaa", targetDir: target }] },
      { consentRead: () => false, runningIds: noRunning, applyOpts: { projectsRoot, backupDir, stamp: "S" } }
    );

    expect(out.consentRequired).toBe(true);
    expect(out.disclosure).toContain("backed up");
    expect(out.moved).toBeUndefined();
  });

  it("re-homes an ended misfiled session and updates + un-flags its index row", () => {
    const filedDir = join(tmp, "parent");
    const target = join(tmp, "real-work");
    mkdirSync(target, { recursive: true });
    seed({ id: "aaa", filedDir, inferredDir: "/x/work", inferredHits: 10, lines: [{ type: "user", cwd: filedDir }] });

    const out: any = toolApplySessionMoves(
      db,
      { moves: [{ sessionId: "aaa", targetDir: target }], acknowledgeRisk: true },
      { consentRead: () => false, consentWrite: () => {}, runningIds: noRunning, applyOpts: { projectsRoot, backupDir, stamp: "S" } }
    );

    expect(out.moved.length).toBe(1);
    expect(out.moved[0].movedTo).toBe(target);
    expect(existsSync(out.moved[0].file)).toBe(true); // relocated file present
    expect(existsSync(out.moved[0].backup)).toBe(true); // backup made
    const row = db.prepare("SELECT project_dir, inferred_dir FROM sessions WHERE id = 'aaa'").get() as {
      project_dir: string;
      inferred_dir: string | null;
    };
    expect(row.project_dir).toBe(target);
    expect(row.inferred_dir).toBeNull(); // no longer misfiled
  });

  it("skips running sessions and non-existent targets, moving the rest", () => {
    const good = join(tmp, "good");
    mkdirSync(good, { recursive: true });
    seed({ id: "run", filedDir: join(tmp, "p1"), inferredDir: "/x", inferredHits: 9, lines: [{ cwd: join(tmp, "p1") }] });
    seed({ id: "gone", filedDir: join(tmp, "p2"), inferredDir: "/x", inferredHits: 9, lines: [{ cwd: join(tmp, "p2") }] });
    seed({ id: "ok", filedDir: join(tmp, "p3"), inferredDir: "/x", inferredHits: 9, lines: [{ cwd: join(tmp, "p3") }] });

    const out: any = toolApplySessionMoves(
      db,
      {
        moves: [
          { sessionId: "run", targetDir: good },
          { sessionId: "gone", targetDir: join(tmp, "nonexistent") },
          { sessionId: "ok", targetDir: good },
        ],
        acknowledgeRisk: true,
      },
      { consentRead: () => true, runningIds: () => new Set(["run"]), applyOpts: { projectsRoot, backupDir, stamp: "S" } }
    );

    expect(out.moved.map((m: any) => m.sessionId)).toEqual(["ok"]);
    expect(out.skipped.find((s: any) => s.sessionId === "run").reason).toContain("running");
    expect(out.skipped.find((s: any) => s.sessionId === "gone").reason).toContain("doesn't exist");
  });
});
