import type Database from "better-sqlite3";
import { listSessions, getSession } from "../db/sessions.js";
import {
  searchMessages,
  searchMessagesExact,
  searchMessagesRegex,
  getSessionMessages,
} from "../db/messages.js";
import { getIndexStats } from "../db/stats.js";
import { classifyMessage } from "../lib/message-kind.js";
import { clampLimit } from "../cli/limit.js";

export function toolListSessions(
  db: Database.Database,
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
  db: Database.Database,
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
  db: Database.Database,
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

export function toolIndexStats(db: Database.Database) {
  return getIndexStats(db);
}
