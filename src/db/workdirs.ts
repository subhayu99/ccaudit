import type Database from "better-sqlite3";
import type { IdentityKind } from "../identity/resolve.js";

/** A workdir row plus its captured commit-hash token-set. */
export type WorkdirRecord = {
  path: string;
  kind: IdentityKind;
  remote: string | null;
  manifestName: string | null;
  rootCommit: string | null;
  existsOnDisk: boolean;
  tokens: string[];
  resolvedAt: number;
};

type WorkdirRowSql = {
  path: string;
  kind: string;
  remote: string | null;
  manifest_name: string | null;
  root_commit: string | null;
  exists_on_disk: number;
  resolved_at: number;
};

function rowToRecord(r: WorkdirRowSql, tokens: string[]): WorkdirRecord {
  return {
    path: r.path,
    kind: r.kind as IdentityKind,
    remote: r.remote,
    manifestName: r.manifest_name,
    rootCommit: r.root_commit,
    existsOnDisk: r.exists_on_disk === 1,
    tokens,
    resolvedAt: r.resolved_at,
  };
}

/** Insert or replace a workdir and its token-set atomically. */
export function upsertWorkdir(db: Database.Database, w: WorkdirRecord): void {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO workdirs
         (path, kind, remote, manifest_name, root_commit, exists_on_disk, resolved_at)
       VALUES (@path, @kind, @remote, @manifestName, @rootCommit, @existsOnDisk, @resolvedAt)
       ON CONFLICT(path) DO UPDATE SET
         kind           = excluded.kind,
         remote         = excluded.remote,
         manifest_name  = excluded.manifest_name,
         root_commit    = excluded.root_commit,
         exists_on_disk = excluded.exists_on_disk,
         resolved_at    = excluded.resolved_at`
    ).run({
      path: w.path,
      kind: w.kind,
      remote: w.remote,
      manifestName: w.manifestName,
      rootCommit: w.rootCommit,
      existsOnDisk: w.existsOnDisk ? 1 : 0,
      resolvedAt: w.resolvedAt,
    });
    db.prepare("DELETE FROM workdir_tokens WHERE path = ?").run(w.path);
    const ins = db.prepare("INSERT OR IGNORE INTO workdir_tokens (path, token) VALUES (?, ?)");
    for (const t of w.tokens) ins.run(w.path, t);
  });
  tx();
}

export function getWorkdir(db: Database.Database, path: string): WorkdirRecord | undefined {
  const row = db.prepare("SELECT * FROM workdirs WHERE path = ?").get(path) as
    | WorkdirRowSql
    | undefined;
  if (!row) return undefined;
  const tokens = (
    db.prepare("SELECT token FROM workdir_tokens WHERE path = ?").all(path) as Array<{
      token: string;
    }>
  ).map((t) => t.token);
  return rowToRecord(row, tokens);
}

export function listWorkdirs(db: Database.Database): WorkdirRecord[] {
  const rows = db.prepare("SELECT * FROM workdirs").all() as WorkdirRowSql[];
  const tokenRows = db.prepare("SELECT path, token FROM workdir_tokens").all() as Array<{
    path: string;
    token: string;
  }>;
  const byPath = new Map<string, string[]>();
  for (const { path, token } of tokenRows) {
    const list = byPath.get(path);
    if (list) list.push(token);
    else byPath.set(path, [token]);
  }
  return rows.map((r) => rowToRecord(r, byPath.get(r.path) ?? []));
}
