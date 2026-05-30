import type Database from "better-sqlite3";
import { sessionKeepCondition } from "./exclusions.js";

export type IndexStats = {
  totalSessions: number;
  totalMessages: number;
  sessionsWithCompacts: number;
  oldestSession: number | null;
  newestSession: number | null;
};

export function getIndexStats(db: Database.Database): IndexStats {
  const excl = sessionKeepCondition(db);
  const row = db
    .prepare(
      `SELECT
         COUNT(*)                                                          AS totalSessions,
         COALESCE(SUM(message_count), 0)                                  AS totalMessages,
         COALESCE(SUM(CASE WHEN compact_count > 0 THEN 1 ELSE 0 END), 0)  AS sessionsWithCompacts,
         COALESCE(MIN(started_at), 0)                                      AS oldestSession,
         COALESCE(MAX(last_activity), 0)                                   AS newestSession
       FROM sessions
      WHERE ${excl.sql}`
    )
    .get(excl.params) as IndexStats;
  return row;
}
