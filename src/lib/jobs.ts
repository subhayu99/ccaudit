/**
 * In-memory locks for long-running AI actions (clustering, bulk renaming). `ccaudit serve` is a
 * single long-lived process, so this module-level state is shared across all requests — letting
 * every page (server-rendered) know a run is already in progress and refuse to start a second one.
 *
 * TTL-guarded: if a request is aborted (user navigated away) and somehow never clears its lock, the
 * lock self-expires so the button can't wedge "running" forever. A normal completion calls endJob().
 */
export type JobKind = "cluster" | "name";
const TTL_MS = 15 * 60 * 1000;
const running = new Map<JobKind, number>(); // kind -> startedAt (epoch ms)

/** Try to start a job. Returns false if one of this kind is already running (within TTL). */
export function beginJob(kind: JobKind): boolean {
  const at = running.get(kind);
  if (at !== undefined && Date.now() - at < TTL_MS) return false;
  running.set(kind, Date.now());
  return true;
}

export function endJob(kind: JobKind): void {
  running.delete(kind);
}

export function isJobRunning(kind: JobKind): boolean {
  const at = running.get(kind);
  if (at === undefined) return false;
  if (Date.now() - at >= TTL_MS) { running.delete(kind); return false; }
  return true;
}

/** Kinds currently running — for the /api/live poll so clients reflect state without a reload. */
export function runningJobs(): JobKind[] {
  return (["cluster", "name"] as JobKind[]).filter(isJobRunning);
}
