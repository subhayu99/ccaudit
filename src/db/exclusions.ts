import type { Db } from "./init.js";

/** True if `path` equals an excluded prefix or sits under one (prefix-safe). */
export function isExcludedPath(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/"));
}

export function addExclusion(db: Db, prefix: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO excluded_prefixes (prefix, created_at) VALUES (?, ?)"
  ).run(prefix, Date.now());
}

export function removeExclusion(db: Db, prefix: string): void {
  db.prepare("DELETE FROM excluded_prefixes WHERE prefix = ?").run(prefix);
}

export function listExclusions(db: Db): string[] {
  return (
    db.prepare("SELECT prefix FROM excluded_prefixes ORDER BY prefix").all() as Array<{
      prefix: string;
    }>
  ).map((r) => r.prefix);
}

// --- Hide rules: a session id, or a phrase/regex over title + USER messages ---
export type RuleKind = "session" | "phrase" | "regex";
export type ExclusionRule = { id: number; kind: RuleKind; value: string };

export function addRule(db: Db, kind: RuleKind, value: string): void {
  const v = value.trim();
  if (!v) return;
  db.prepare("INSERT OR IGNORE INTO excluded_rules (kind, value, created_at) VALUES (?, ?, ?)").run(kind, v, Date.now());
}
export function removeRule(db: Db, id: number): void {
  db.prepare("DELETE FROM excluded_rules WHERE id = ?").run(id);
}
export function listRules(db: Db): ExclusionRule[] {
  return db.prepare("SELECT id, kind, value FROM excluded_rules ORDER BY created_at DESC").all() as ExclusionRule[];
}
/** Cheap signature of the rule set (for cache keys). */
export function rulesSignature(db: Db): string {
  return listRules(db).map((r) => `${r.kind}:${r.value}`).join("|");
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
  db: Db,
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

/**
 * Condition keeping a session visible only if NEITHER its `project_dir` NOR its
 * `cwd` is under an excluded prefix. Lets the user hide either the encoded
 * project directory (Directories page) or the real working directory / repo
 * (sidebar). A null cwd is unaffected by cwd matching. For queries over the
 * `sessions` table (both columns present).
 */
export function sessionKeepCondition(
  db: Db
): { sql: string; params: Record<string, string> } {
  const prefixes = listExclusions(db);
  const rules = listRules(db);
  if (prefixes.length === 0 && rules.length === 0) return { sql: "1", params: {} };
  const params: Record<string, string> = {};
  const parts: string[] = [];
  prefixes.forEach((p, i) => {
    const k = `sx${i}`;
    params[k] = p;
    parts.push(`NOT (project_dir = @${k} OR substr(project_dir, 1, length(@${k}) + 1) = @${k} || '/')`);
    parts.push(`(cwd IS NULL OR NOT (cwd = @${k} OR substr(cwd, 1, length(@${k}) + 1) = @${k} || '/'))`);
  });
  // Hide rules. `mr` is a private alias for the correlated message scan so it never collides
  // with a caller's `m`. Phrase = case-insensitive literal substring; regex = ccaudit_regexp.
  // Matched against the session title OR its USER messages — assistant replies are excluded.
  rules.forEach((r, i) => {
    const k = `rk${i}`;
    params[k] = r.value;
    if (r.kind === "session") {
      parts.push(`sessions.id <> @${k}`);
    } else if (r.kind === "phrase") {
      parts.push(
        `NOT (instr(lower(COALESCE(ai_title, first_prompt, '')), lower(@${k})) > 0 OR EXISTS (` +
        `SELECT 1 FROM messages mr WHERE mr.session_id = sessions.id AND mr.type = 'user' AND mr.text_content IS NOT NULL ` +
        `AND instr(lower(mr.text_content), lower(@${k})) > 0))`
      );
    } else {
      parts.push(
        `NOT (ccaudit_regexp(@${k}, COALESCE(ai_title, first_prompt, '')) = 1 OR EXISTS (` +
        `SELECT 1 FROM messages mr WHERE mr.session_id = sessions.id AND mr.type = 'user' AND mr.text_content IS NOT NULL ` +
        `AND ccaudit_regexp(@${k}, mr.text_content) = 1))`
      );
    }
  });
  return { sql: parts.join(" AND "), params };
}
