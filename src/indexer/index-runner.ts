import type { Db } from "../db/init.js";
import { checkpointWal } from "../db/init.js";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { walkCodexSessions, parseCodexSession } from "./codex.js";
import { walkProjects } from "./walk.js";
import { parseJsonlFile } from "./parse.js";
import { newAggregator, finalizeAggregator } from "./aggregate.js";
import { getSessionByFilePath, upsertSession, deleteSession } from "../db/sessions.js";
import { deleteSessionMessages, insertMessages } from "../db/messages.js";
import { resolveWorkdirs } from "./resolve-workdirs.js";
import { inferSessionWorkdir } from "../lib/session-dirs.js";
import { backfillInference } from "./backfill-inference.js";
import { isExcludedPath, listExclusions } from "../db/exclusions.js";
import { CLAUDE_PROJECTS_DIR, CODEX_DIRS, LOGS_DIR } from "../paths.js";
import type { Session } from "../types.js";

// Structured progress so callers can render a live spinner/counter instead of a
// scrolling log: scan (we now know the total) → index (counting up) → resolve.
export type IndexProgress =
  | { phase: "scan"; total: number }
  | { phase: "index"; current: number; total: number; label: string }
  | { phase: "resolve" }
  | { phase: "infer"; current: number; total: number };

export type IndexRunOptions = {
  baseDir?: string;        // default: ~/.claude/projects
  /** Explicit baseDir isolates Claude fixtures unless codexDirs is also supplied. */
  codexDirs?: string[];
  force?: boolean;         // re-index even if mtime+size match
  onProgress?: (p: IndexProgress) => void;
};

export type IndexRunStats = {
  filesSeen: number;
  sessionsIndexed: number;
  sessionsSkipped: number;
  malformedLines: number;
  errors: number;
  workdirsResolved: number;
  inferenceBackfilled: number;
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
  db: Db,
  opts: IndexRunOptions = {}
): Promise<IndexRunStats> {
  const baseDir = opts.baseDir ?? CLAUDE_PROJECTS_DIR;
  const stats: IndexRunStats = {
    filesSeen: 0, sessionsIndexed: 0, sessionsSkipped: 0,
    malformedLines: 0, errors: 0, workdirsResolved: 0, inferenceBackfilled: 0,
  };
  const entries = [
    ...walkProjects(baseDir).map(e => ({ ...e, provider: "claude" as const })),
    ...await walkCodexSessions(opts.codexDirs ?? (opts.baseDir ? [] : CODEX_DIRS)),
  ];
  opts.onProgress?.({ phase: "scan", total: entries.length });
  const exclusions = listExclusions(db);
  for (const e of entries) {
    stats.filesSeen += 1;
    // Fire on every entry (indexed or skipped) so the counter advances smoothly.
    opts.onProgress?.({ phase: "index", current: stats.filesSeen, total: entries.length, label: e.projectLabel });
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
    let state;
    try {
      if (e.provider === "codex") {
        state = await parseCodexSession(e.filePath, e.sessionId, {
          onError: (err) => {
            stats.malformedLines += 1;
            logIndexError(`${new Date().toISOString()} ${e.filePath}:${err.lineNo} malformed Codex record`);
          },
        });
      } else {
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
        state = finalizeAggregator(agg);
      }
    } catch (err) {
      stats.errors += 1;
      logIndexError(
        `${new Date().toISOString()} ${e.filePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    // Exclude ccaudit's own `claude -p` tool sessions (they pollute the history with our
    // prompt text). Evict any previously-indexed copy and skip insertion.
    if (state.isInternal) {
      if (existing) deleteSession(db, e.sessionId);
      stats.sessionsSkipped += 1;
      continue;
    }

    // Precompute the work-dir inference now, while every message is already in memory —
    // so `list_mismatched_sessions` is a fast indexed query, never an on-demand transcript
    // scan. The launch/filed anchor is the recorded cwd (exact), falling back to the
    // decoded project dir. Best-effort: a detection error must never break indexing.
    let inferredDir: string | null = null;
    let inferredHits = 0;
    let inferredLaunchHits = 0;
    try {
      const inf = e.provider === "codex" ? { inferredDir: null, inferredHits: 0, launchHits: 0 } : inferSessionWorkdir(state.messages, { currentDir: state.cwd ?? e.projectDir });
      inferredDir = inf.inferredDir;
      inferredHits = inf.inferredHits;
      inferredLaunchHits = inf.launchHits;
    } catch {
      /* leave defaults — session simply won't be flagged as misfiled */
    }

    const session: Session = {
      id: e.sessionId,
      provider: e.provider,
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
      aiTitle: state.customTitle ?? state.aiTitle,
      cwd: state.cwd,
      indexedAt: Date.now(),
      tokenUsage: Object.keys(state.tokenUsage).length > 0 ? state.tokenUsage : null,
      inferredDir,
      inferredHits,
      inferredLaunchHits,
    };

    // Append-only fast path: session logs only grow (a given line_no's content never changes),
    // so when the file got LARGER we keep the existing message rows and let insertMessages
    // (INSERT OR IGNORE) add just the new lines — FTS re-tokenizes only the delta, not the whole
    // (possibly tens-of-thousands-of-message) session. Any other change (shrunk, or --force) does
    // the safe full rebuild: delete every row, then re-insert. Codex can replace event
    // echoes with response items, so changed Codex logs always rebuild their rows.
    const appendOnly = e.provider === "claude" && !opts.force && !!existing && e.fileSize > existing.fileSize;
    const tx = db.transaction(() => {
      upsertSession(db, session);
      if (!appendOnly) deleteSessionMessages(db, e.sessionId);
      if (state.messages.length > 0) insertMessages(db, state.messages);
    });
    tx();
    stats.sessionsIndexed += 1;
  }

  // Layer 1 repo-identity: capture immutable tokens for each distinct cwd
  // while the directory still exists. Idempotent across runs (skips already
  // captured workdirs unless forced).
  opts.onProgress?.({ phase: "resolve" });
  stats.workdirsResolved = resolveWorkdirs(db, { force: opts.force });

  // Back-fill work-dir inference for any session indexed before inference existed (or skipped as
  // unchanged), reading messages from the DB — so the Misfiled view is complete without a manual
  // `reindex --force`. One-time per session; steady-state this is a no-op.
  stats.inferenceBackfilled = backfillInference(db, {
    onProgress: (current, total) => opts.onProgress?.({ phase: "infer", current, total }),
  });

  // Fold the WAL back into the DB and truncate it, so it can't grow without bound across the
  // many index passes (serve boot, periodic refresh, watch tick). Bounds the SQLITE_BUSY risk.
  checkpointWal(db);

  return stats;
}
