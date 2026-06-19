import type { Db } from "../db/init.js";
import { getSessionMessages } from "../db/messages.js";
import { inferSessionWorkdir, type DirKind } from "../lib/session-dirs.js";

export type BackfillDeps = {
  /** Progress callback (current, total). */
  onProgress?: (current: number, total: number) => void;
  /** Clock (defaults to Date.now). */
  now?: () => number;
  /** Injected dir resolver (defaults to the real fs check) — for tests. */
  resolve?: (p: string) => DirKind;
  /** Override $HOME (defaults to the real home dir) — for tests. */
  home?: string;
};

/**
 * Compute work-dir inference for any session that hasn't had it computed yet
 * (`inferred_at IS NULL`), reading the messages already stored in the DB — no JSONL
 * re-parse, no FTS rebuild. This back-fills sessions indexed by a pre-inference build so
 * the Misfiled view works without the user running `reindex --force`. Each session is
 * stamped `inferred_at` so it's processed exactly once; steady-state this finds nothing.
 *
 * Returns the number of sessions back-filled.
 */
export function backfillInference(db: Db, deps: BackfillDeps = {}): number {
  const now = deps.now ?? Date.now;
  const todo = db
    .prepare("SELECT id, cwd, project_dir FROM sessions WHERE inferred_at IS NULL")
    .all() as Array<{ id: string; cwd: string | null; project_dir: string }>;
  if (todo.length === 0) return 0;

  const upd = db.prepare(
    "UPDATE sessions SET inferred_dir = ?, inferred_hits = ?, inferred_launch_hits = ?, inferred_at = ? WHERE id = ?"
  );

  let done = 0;
  for (const s of todo) {
    deps.onProgress?.(done, todo.length);
    try {
      const msgs = getSessionMessages(db, s.id);
      const inf = inferSessionWorkdir(msgs, { currentDir: s.cwd ?? s.project_dir, resolve: deps.resolve, home: deps.home });
      upd.run(inf.inferredDir, inf.inferredHits, inf.launchHits, now(), s.id);
    } catch {
      // Mark it processed anyway so one bad session can't loop the backfill forever.
      upd.run(null, 0, 0, now(), s.id);
    }
    done++;
  }
  return done;
}
