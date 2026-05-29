import type Database from "better-sqlite3";

/** True if `path` equals an excluded prefix or sits under one (prefix-safe). */
export function isExcludedPath(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/"));
}

export function addExclusion(db: Database.Database, prefix: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO excluded_prefixes (prefix, created_at) VALUES (?, ?)"
  ).run(prefix, Date.now());
}

export function removeExclusion(db: Database.Database, prefix: string): void {
  db.prepare("DELETE FROM excluded_prefixes WHERE prefix = ?").run(prefix);
}

export function listExclusions(db: Database.Database): string[] {
  return (
    db.prepare("SELECT prefix FROM excluded_prefixes ORDER BY prefix").all() as Array<{
      prefix: string;
    }>
  ).map((r) => r.prefix);
}

/**
 * A SQL boolean expression that is TRUE for rows to KEEP (not excluded), with
 * named parameters. Append to a WHERE: `WHERE ${sql}` or `... AND ${sql}`.
 * Returns `"1"` (keep everything) when no exclusions are set.
 *
 * Uses substr/length comparison rather than LIKE so path characters like `_`
 * and `%` are never treated as wildcards. Sibling prefixes (e.g. `/a/backend-2`
 * under `/a/backend`) are correctly NOT matched.
 */
export function exclusionCondition(
  db: Database.Database,
  col = "project_dir"
): { sql: string; params: Record<string, string> } {
  const prefixes = listExclusions(db);
  if (prefixes.length === 0) return { sql: "1", params: {} };
  const params: Record<string, string> = {};
  const parts = prefixes.map((p, i) => {
    const key = `cx${i}`;
    params[key] = p;
    return `NOT (${col} = @${key} OR substr(${col}, 1, length(@${key}) + 1) = @${key} || '/')`;
  });
  return { sql: parts.join(" AND "), params };
}
