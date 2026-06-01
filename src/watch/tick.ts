import type Database from "better-sqlite3";
import type { LiveInstance } from "./registry.js";
import { upsertLive, markEnded } from "../db/live-sessions.js";

export type WatchTickDeps = {
  now: number;
  bootTime: number;
  registry: () => LiveInstance[];
};

export type WatchTickSummary = { running: number; endedNow: number };

/**
 * One reconcile pass: refresh every live instance, then mark any still-running DB
 * row that's no longer in the registry as ended — 'restart' if its last_seen
 * predates the machine boot, else 'exited'. Idempotent and wrapped in a single tx.
 */
export function runWatchTick(db: Database.Database, deps: WatchTickDeps): WatchTickSummary {
  const live = deps.registry();
  const liveIds = new Set(live.map((l) => l.sessionId));

  const tx = db.transaction((): number => {
    for (const inst of live) upsertLive(db, inst, deps.now);
    const running = db.prepare(
      "SELECT session_id AS sessionId, last_seen AS lastSeen FROM live_sessions WHERE ended_at IS NULL"
    ).all() as Array<{ sessionId: string; lastSeen: number }>;
    let endedNow = 0;
    for (const row of running) {
      if (liveIds.has(row.sessionId)) continue;
      const reason = row.lastSeen < deps.bootTime ? "restart" : "exited";
      markEnded(db, row.sessionId, deps.now, reason);
      endedNow++;
    }
    return endedNow;
  });

  const endedNow = tx();
  return { running: live.length, endedNow };
}
