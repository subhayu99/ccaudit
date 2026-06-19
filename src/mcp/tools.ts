import { existsSync } from "node:fs";
import type { Db } from "../db/init.js";
import { listSessions, getSession } from "../db/sessions.js";
import {
  searchMessages,
  searchMessagesExact,
  searchMessagesRegex,
  getSessionMessages,
  getMessagesByAuthor,
} from "../db/messages.js";
import type { MessageAuthor } from "../lib/message-kind.js";
import { getIndexStats } from "../db/stats.js";
import { classifyMessage } from "../lib/message-kind.js";
import { clampLimit } from "../cli/limit.js";
import { readLiveRegistry } from "../watch/registry.js";
import { getBootTime } from "../lib/boot-time.js";
import { readConfig, writeConfig } from "../lib/config.js";
import { sessionKeepCondition } from "../db/exclusions.js";
import { REHOME_DISCLOSURE, applyRehomeToDb, type ApplyRehomeOpts } from "../lib/rehome-apply.js";

export function toolListSessions(
  db: Db,
  args: { limit?: number; project?: string }
) {
  const sessions = listSessions(db, { limit: clampLimit(args.limit, 30), projectDir: args.project });
  return sessions.map((s) => ({
    id: s.id,
    project: s.projectLabel,
    projectDir: s.projectDir,
    lastActivity: s.lastActivity,
    messageCount: s.messageCount,
    compactCount: s.compactCount,
    firstPrompt: s.firstPrompt,
    aiTitle: s.aiTitle,
  }));
}

export function toolSearchSessions(
  db: Db,
  args: { query: string; mode?: "fts" | "exact" | "regex"; limit?: number }
) {
  const limit = clampLimit(args.limit, 20);
  const mode = args.mode ?? "fts";
  const hits =
    mode === "exact"
      ? searchMessagesExact(db, args.query, { limit })
      : mode === "regex"
        ? searchMessagesRegex(db, args.query, { limit })
        : searchMessages(db, args.query, { limit });
  return hits.map((h) => {
    const sess = getSession(db, h.sessionId);
    return {
      sessionId: h.sessionId,
      lineNo: h.lineNo,
      project: sess?.projectLabel ?? null,
      // strip the <mark> tags FTS adds, for a clean snippet
      snippet: h.snippet.replace(/<\/?mark>/g, ""),
    };
  });
}

export function toolGetSession(
  db: Db,
  args: { sessionId: string; includeMessages?: boolean; limit?: number }
) {
  const session = getSession(db, args.sessionId);
  if (!session) return { error: "session not found", sessionId: args.sessionId };
  const base = {
    id: session.id,
    project: session.projectLabel,
    projectDir: session.projectDir,
    cwd: session.cwd,
    gitBranch: session.gitBranch,
    startedAt: session.startedAt,
    lastActivity: session.lastActivity,
    messageCount: session.messageCount,
    compactCount: session.compactCount,
    title: session.aiTitle ?? session.firstPrompt,
  };
  if (!args.includeMessages) return base;
  const all = getSessionMessages(db, args.sessionId);
  // Only return meaningful conversation messages (skip noise), with text.
  const limit = clampLimit(args.limit, 200);
  const msgs = all
    .filter((m) => classifyMessage(m) !== "noise")
    .slice(0, limit)
    .map((m) => ({
      lineNo: m.lineNo,
      role: m.role ?? m.type,
      kind: classifyMessage(m),
      text: m.textContent,
      isCompactSummary: m.isCompactSummary,
    }));
  return { ...base, messages: msgs };
}

export function toolGetMessages(
  db: Db,
  args: { author: MessageAuthor; sessionId?: string; contains?: string; limit?: number }
) {
  const limit = clampLimit(args.limit, 50);
  const msgs = getMessagesByAuthor(db, {
    author: args.author,
    sessionId: args.sessionId,
    contains: args.contains,
    limit,
  });
  return msgs.map((m) => ({
    sessionId: m.sessionId,
    lineNo: m.lineNo,
    author: args.author,
    timestamp: m.timestamp,
    text: m.textContent,
  }));
}

export function toolIndexStats(db: Db) {
  return getIndexStats(db);
}

/** Live (currently-running) Claude Code session ids, used to refuse moving an active session. */
type RunningIdsFn = () => Set<string>;
const defaultRunningIds: RunningIdsFn = () =>
  new Set(readLiveRegistry({ bootTime: getBootTime(Date.now()) }).map((r) => r.sessionId));

type MismatchedRow = {
  id: string;
  project_label: string;
  project_dir: string;
  cwd: string | null;
  inferred_dir: string;
  inferred_hits: number;
  inferred_launch_hits: number;
  ai_title: string | null;
  first_prompt: string | null;
};

/**
 * List sessions ccaudit thinks are misfiled — filed under one directory but where the
 * referenced work actually lived in another (precomputed at index time, so this is a
 * fast indexed query, never a transcript scan). Ordered by the strongest evidence first
 * (how much the inferred dir out-references the filed one). Each row carries a `running`
 * flag because a live session can't be moved until it's closed. Feed the chosen
 * { sessionId, targetDir } pairs to `apply_session_moves` to re-home them.
 */
export function toolListMismatchedSessions(
  db: Db,
  args: { limit?: number; includeHidden?: boolean } = {},
  deps: { runningIds?: RunningIdsFn } = {}
) {
  const limit = clampLimit(args.limit, 50);
  const includeHidden = !!args.includeHidden;
  const running = (deps.runningIds ?? defaultRunningIds)();

  // The misfiled set is a small subset, so fetch it all (ordered) and slice after filtering.
  const all = db
    .prepare(
      `SELECT id, project_label, project_dir, cwd, inferred_dir,
              inferred_hits, inferred_launch_hits, ai_title, first_prompt
         FROM sessions
        WHERE inferred_dir IS NOT NULL
        ORDER BY (inferred_hits - inferred_launch_hits) DESC, inferred_hits DESC`
    )
    .all() as MismatchedRow[];

  // Honor the same global hide-filters as every other view (excluded dirs + session/phrase/regex
  // rules), so sessions the user has discarded — e.g. ~/.claude-mem observer sessions — don't
  // reappear here. `keptIds` is the set that survives the filter; everything else is "hidden".
  const keep = sessionKeepCondition(db);
  const keptIds =
    keep.sql === "1"
      ? null
      : new Set(
          (
            db
              .prepare(`SELECT id FROM sessions WHERE inferred_dir IS NOT NULL AND (${keep.sql})`)
              .all(keep.params) as Array<{ id: string }>
          ).map((r) => r.id)
        );

  const marked = all.map((r) => ({ r, hidden: keptIds ? !keptIds.has(r.id) : false }));
  const hiddenCount = marked.filter((m) => m.hidden).length;
  const chosen = (includeHidden ? marked : marked.filter((m) => !m.hidden)).slice(0, limit);

  const sessions = chosen.map(({ r, hidden }) => ({
    sessionId: r.id,
    title: r.ai_title ?? (r.first_prompt ? r.first_prompt.slice(0, 80) : null),
    filedUnder: r.cwd ?? r.project_dir,
    inferredDir: r.inferred_dir,
    evidence: { inferredHits: r.inferred_hits, launchHits: r.inferred_launch_hits },
    running: running.has(r.id),
    hidden,
  }));

  return {
    count: sessions.length,
    hiddenCount,
    consentGiven: readConfig().rehomeConsent === "accepted",
    note:
      "Sessions whose work mostly happened in a directory other than where they're filed. " +
      "Sessions you've hidden (excluded dirs / rules) are filtered out by default — pass " +
      "includeHidden:true to include them. Re-home with apply_session_moves using the chosen " +
      "{ sessionId, targetDir } pairs (confirm each target first). Running ones can't move until closed.",
    sessions,
  };
}

/**
 * Batch re-home misfiled sessions. One consolidated consent gate guards the whole batch:
 * the first call (on a machine that hasn't consented) returns `{ consentRequired, disclosure }`
 * and writes nothing; re-call with `acknowledgeRisk: true` to proceed and record consent.
 * Running sessions, missing sessions, and non-existent targets are skipped (not fatal); the
 * rest are re-homed via the shared, backup-first `applyRehomeToDb`.
 */
export function toolApplySessionMoves(
  db: Db,
  args: { moves?: Array<{ sessionId: string; targetDir: string }>; acknowledgeRisk?: boolean } = {},
  deps: {
    runningIds?: RunningIdsFn;
    applyOpts?: ApplyRehomeOpts;
    consentRead?: () => boolean;
    consentWrite?: () => void;
  } = {}
) {
  const moves = Array.isArray(args.moves) ? args.moves : [];
  if (moves.length === 0) return { error: "no moves provided — pass moves: [{ sessionId, targetDir }]" };

  const consentRead = deps.consentRead ?? (() => readConfig().rehomeConsent === "accepted");
  const consentWrite = deps.consentWrite ?? (() => writeConfig({ rehomeConsent: "accepted" }));

  // One consolidated consent prompt for the whole batch (re-home writes into ~/.claude).
  if (!consentRead()) {
    if (!args.acknowledgeRisk) {
      return {
        consentRequired: true,
        disclosure: REHOME_DISCLOSURE,
        moves,
        note: "Re-call apply_session_moves with acknowledgeRisk: true to proceed (asked once per machine).",
      };
    }
    consentWrite();
  }

  const running = (deps.runningIds ?? defaultRunningIds)();
  const moved: Array<{ sessionId: string; movedTo: string; file: string; backup: string; linesRewritten: number }> = [];
  const skipped: Array<{ sessionId: string; reason: string }> = [];
  const errors: Array<{ sessionId: string; error: string }> = [];

  for (const mv of moves) {
    const sessionId = String(mv?.sessionId ?? "");
    const targetDir = String(mv?.targetDir ?? "");
    const session = sessionId ? getSession(db, sessionId) : null;
    if (!session) { skipped.push({ sessionId, reason: "session not found in index" }); continue; }
    if (!targetDir) { skipped.push({ sessionId, reason: "no targetDir given" }); continue; }
    if (running.has(sessionId)) { skipped.push({ sessionId, reason: "currently running — close it in Claude Code first" }); continue; }
    if (!existsSync(targetDir)) { skipped.push({ sessionId, reason: `target directory doesn't exist: ${targetDir}` }); continue; }
    try {
      const res = applyRehomeToDb(db, session, targetDir, deps.applyOpts);
      moved.push({ sessionId, movedTo: targetDir, file: res.targetFile, backup: res.backupFile, linesRewritten: res.linesRewritten });
    } catch (e) {
      errors.push({ sessionId, error: (e as Error).message });
    }
  }
  return { moved, skipped, errors };
}
