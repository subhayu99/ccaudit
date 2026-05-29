import type Database from "better-sqlite3";
import { exclusionCondition } from "./exclusions.js";

export type IndexStats = {
  totalSessions: number;
  totalMessages: number;
  sessionsWithCompacts: number;
  oldestSession: number | null;
  newestSession: number | null;
};

export function getIndexStats(db: Database.Database): IndexStats {
  const excl = exclusionCondition(db);
  const row = db
    .prepare(
      `SELECT
         COUNT(*)                                              AS totalSessions,
         COALESCE(SUM(message_count), 0)                      AS totalMessages,
         SUM(CASE WHEN compact_count > 0 THEN 1 ELSE 0 END)  AS sessionsWithCompacts,
         MIN(started_at)                                       AS oldestSession,
         MAX(last_activity)                                    AS newestSession
       FROM sessions
      WHERE ${excl.sql}`
    )
    .get(excl.params) as IndexStats;
  return row;
}
