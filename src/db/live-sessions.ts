import type Database from "better-sqlite3";
import type { LiveInstance } from "../watch/registry.js";

export type LiveRow = {
  sessionId: string;
  pid: number | null;
  cwd: string | null;
  name: string | null;
  status: string | null;
  version: string | null;
  startedAt: number | null;
  firstSeen: number;
  lastSeen: number;
  endedAt: number | null;
  endedReason: string | null;
};

type RawRow = {
  session_id: string; pid: number | null; cwd: string | null; name: string | null;
  status: string | null; version: string | null; started_at: number | null;
  first_seen: number; last_seen: number; ended_at: number | null; ended_reason: string | null;
};

function mapRow(r: RawRow): LiveRow {
  return {
    sessionId: r.session_id, pid: r.pid, cwd: r.cwd, name: r.name, status: r.status,
    version: r.version, startedAt: r.started_at, firstSeen: r.first_seen, lastSeen: r.last_seen,
    endedAt: r.ended_at, endedReason: r.ended_reason,
  };
}

/** Insert or refresh a running row. Clears any prior ended state; first_seen is kept on refresh. */
export function upsertLive(db: Database.Database, inst: LiveInstance, now: number): void {
  db.prepare(`
    INSERT INTO live_sessions
      (session_id, pid, cwd, name, status, version, started_at, first_seen, last_seen, ended_at, ended_reason)
    VALUES (@sessionId, @pid, @cwd, @name, @status, @version, @startedAt, @now, @now, NULL, NULL)
    ON CONFLICT(session_id) DO UPDATE SET
      pid=excluded.pid, cwd=excluded.cwd, name=excluded.name, status=excluded.status,
      version=excluded.version, started_at=excluded.started_at,
      last_seen=excluded.last_seen, ended_at=NULL, ended_reason=NULL
  `).run({
    sessionId: inst.sessionId, pid: inst.pid, cwd: inst.cwd, name: inst.name, status: inst.status,
    version: inst.version, startedAt: inst.startedAt, now,
  });
}

export function markEnded(db: Database.Database, sessionId: string, at: number, reason: "exited" | "restart"): void {
  db.prepare("UPDATE live_sessions SET ended_at=?, ended_reason=? WHERE session_id=? AND ended_at IS NULL")
    .run(at, reason, sessionId);
}

/** Running rows first (by last_seen desc), then ended rows with ended_at >= endedSince (by ended_at desc). */
export function listLive(db: Database.Database, opts: { endedSince?: number } = {}): LiveRow[] {
  const since = opts.endedSince ?? 0;
  const rows = db.prepare(`
    SELECT * FROM live_sessions
     WHERE ended_at IS NULL OR ended_at >= ?
     ORDER BY (ended_at IS NULL) DESC, COALESCE(ended_at, last_seen) DESC
  `).all(since) as RawRow[];
  return rows.map(mapRow);
}

/** Of the given session ids, which exist in the indexed `sessions` table. */
export function indexedSessionIds(db: Database.Database, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id FROM sessions WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}
