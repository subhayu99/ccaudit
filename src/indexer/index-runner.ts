import type Database from "better-sqlite3";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { walkProjects } from "./walk.js";
import { parseJsonlFile } from "./parse.js";
import { newAggregator, finalizeAggregator } from "./aggregate.js";
import { getSessionByFilePath, upsertSession } from "../db/sessions.js";
import { deleteSessionMessages, insertMessages } from "../db/messages.js";
import { resolveWorkdirs } from "./resolve-workdirs.js";
import { isExcludedPath, listExclusions } from "../db/exclusions.js";
import { CLAUDE_PROJECTS_DIR, LOGS_DIR } from "../paths.js";
import type { Session } from "../types.js";

export type IndexRunOptions = {
  baseDir?: string;        // default: ~/.claude/projects
  force?: boolean;         // re-index even if mtime+size match
  onProgress?: (msg: string) => void;
};

export type IndexRunStats = {
  filesSeen: number;
  sessionsIndexed: number;
  sessionsSkipped: number;
  malformedLines: number;
  errors: number;
  workdirsResolved: number;
};

function logIndexError(line: string): void {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(join(LOGS_DIR, "index-errors.log"), line + "\n");
  } catch {
    // best-effort logging only
  }
}

export async function indexAll(
  db: Database.Database,
  opts: IndexRunOptions = {}
): Promise<IndexRunStats> {
  const baseDir = opts.baseDir ?? CLAUDE_PROJECTS_DIR;
  const stats: IndexRunStats = {
    filesSeen: 0, sessionsIndexed: 0, sessionsSkipped: 0,
    malformedLines: 0, errors: 0, workdirsResolved: 0,
  };
  const entries = walkProjects(baseDir);
  const exclusions = listExclusions(db);
  for (const e of entries) {
    stats.filesSeen += 1;
    // Skip indexing directories the user has hidden (matched on the recorded
    // cwd, falling back to the project dir). Already-indexed rows are kept and
    // simply filtered from views, so un-hiding is instant.
    if (
      exclusions.length > 0 &&
      (isExcludedPath(e.projectDir, exclusions))
    ) {
      stats.sessionsSkipped += 1;
      continue;
    }
    const existing = getSessionByFilePath(db, e.filePath);
    if (
      !opts.force &&
      existing &&
      existing.fileMtime === e.fileMtime &&
      existing.fileSize === e.fileSize
    ) {
      stats.sessionsSkipped += 1;
      continue;
    }

    const agg = newAggregator();
    try {
      for await (const item of parseJsonlFile(e.filePath, {
        onError: (err) => {
          stats.malformedLines += 1;
          logIndexError(
            `${new Date().toISOString()} ${e.filePath}:${err.lineNo} ${
              err.error instanceof Error ? err.error.message : String(err.error)
            }`
          );
        },
      })) {
        agg.observe({ ...item, sessionId: e.sessionId });
      }
    } catch (err) {
      stats.errors += 1;
      logIndexError(
        `${new Date().toISOString()} ${e.filePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    const state = finalizeAggregator(agg);
    const session: Session = {
      id: e.sessionId,
      projectDir: e.projectDir,
      projectLabel: e.projectLabel,
      filePath: e.filePath,
      fileMtime: e.fileMtime,
      fileSize: e.fileSize,
      startedAt: state.startedAt,
      lastActivity: state.lastActivity,
      gitBranch: state.gitBranch,
      messageCount: state.messageCount,
      userMsgCount: state.userMsgCount,
      compactCount: state.compactCount,
      firstPrompt: state.firstPrompt,
      aiTitle: state.aiTitle,
      cwd: state.cwd,
      indexedAt: Date.now(),
    };

    const tx = db.transaction(() => {
      upsertSession(db, session);
      deleteSessionMessages(db, e.sessionId);
      if (state.messages.length > 0) insertMessages(db, state.messages);
    });
    tx();
    stats.sessionsIndexed += 1;
    opts.onProgress?.(`indexed ${e.projectLabel}/${e.sessionId} (${state.messageCount} msgs)`);
  }

  // Layer 1 repo-identity: capture immutable tokens for each distinct cwd
  // while the directory still exists. Idempotent across runs (skips already
  // captured workdirs unless forced).
  stats.workdirsResolved = resolveWorkdirs(db, { force: opts.force });
  if (stats.workdirsResolved > 0) {
    opts.onProgress?.(`resolved ${stats.workdirsResolved} workdir identities`);
  }

  return stats;
}
