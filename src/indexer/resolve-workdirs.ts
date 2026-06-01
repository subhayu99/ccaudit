import type { Db } from "../db/init.js";
import { existsSync } from "node:fs";
import { resolveIdentity, type GitRunner } from "../identity/resolve.js";
import { getWorkdir, upsertWorkdir } from "../db/workdirs.js";

export type ResolveWorkdirsDeps = {
  /** Injected git runner (defaults to the real one). */
  git?: GitRunner;
  /** Injected existence check (defaults to fs.existsSync). */
  exists?: (path: string) => boolean;
  /** Re-resolve workdirs already captured. */
  force?: boolean;
  /** Clock (defaults to Date.now). */
  now?: () => number;
};

/**
 * Capture immutable identity tokens for every distinct session `cwd` and
 * persist them as workdir records. Idempotent: a cwd already captured is
 * skipped unless `force`. This is the "read while the directory still exists"
 * step from the design doc — tokens not captured before a dir is deleted are
 * permanently unmatchable.
 *
 * Returns the number of workdirs (re)resolved.
 */
export function resolveWorkdirs(db: Db, deps: ResolveWorkdirsDeps = {}): number {
  const exists = deps.exists ?? existsSync;
  const now = deps.now ?? Date.now;

  const cwds = (
    db.prepare("SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL").all() as Array<{
      cwd: string;
    }>
  ).map((r) => r.cwd);

  let resolved = 0;
  for (const cwd of cwds) {
    if (!deps.force && getWorkdir(db, cwd)) continue;
    const existsOnDisk = exists(cwd);
    const id = resolveIdentity(cwd, { existsOnDisk, git: deps.git });
    upsertWorkdir(db, {
      path: cwd,
      kind: id.kind,
      remote: id.remote ?? null,
      manifestName: id.manifestName ?? null,
      rootCommit: id.root ?? null,
      existsOnDisk,
      tokens: id.tokens,
      resolvedAt: now(),
    });
    resolved += 1;
  }
  return resolved;
}
