import type { Db } from "./init.js";
import { sessionKeepCondition } from "./exclusions.js";
import { rangeCondition, type DateRange } from "./date-range.js";

export type IndexStats = {
  totalSessions: number;
  totalMessages: number;
  sessionsWithCompacts: number;
  oldestSession: number | null;
  newestSession: number | null;
};

export function getIndexStats(db: Db, range: DateRange | null = null): IndexStats {
  const excl = sessionKeepCondition(db);
  const rg = rangeCondition(range, "last_activity");
  const row = db
    .prepare(
      `SELECT
         COUNT(*)                                                          AS totalSessions,
         COALESCE(SUM(message_count), 0)                                  AS totalMessages,
         COALESCE(SUM(CASE WHEN compact_count > 0 THEN 1 ELSE 0 END), 0)  AS sessionsWithCompacts,
         COALESCE(MIN(started_at), 0)                                      AS oldestSession,
         COALESCE(MAX(last_activity), 0)                                   AS newestSession
       FROM sessions
      WHERE ${excl.sql} AND ${rg.sql}`
    )
    .get({ ...excl.params, ...rg.params }) as IndexStats;
  return row;
}
