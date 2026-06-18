import type { Db } from "./init.js";
import type { Session } from "../types.js";
import { exclusionCondition, sessionKeepCondition } from "./exclusions.js";

type SessionRowSql = {
  id: string;
  project_dir: string;
  project_label: string;
  file_path: string;
  file_mtime: number;
  file_size: number;
  started_at: number | null;
  last_activity: number | null;
  git_branch: string | null;
  message_count: number;
  user_msg_count: number;
  compact_count: number;
  first_prompt: string | null;
  ai_title: string | null;
  cwd: string | null;
  token_usage: string | null;
  inferred_dir: string | null;
  inferred_hits: number;
  inferred_launch_hits: number;
  indexed_at: number;
};

function rowToSession(r: SessionRowSql): Session {
  return {
    id: r.id,
    projectDir: r.project_dir,
    projectLabel: r.project_label,
    filePath: r.file_path,
    fileMtime: r.file_mtime,
    fileSize: r.file_size,
    startedAt: r.started_at,
    lastActivity: r.last_activity,
    gitBranch: r.git_branch,
    messageCount: r.message_count,
    userMsgCount: r.user_msg_count,
    compactCount: r.compact_count,
    firstPrompt: r.first_prompt,
    aiTitle: r.ai_title,
    cwd: r.cwd,
    indexedAt: r.indexed_at,
    tokenUsage: parseTokenUsage(r.token_usage),
    inferredDir: r.inferred_dir,
    inferredHits: r.inferred_hits,
    inferredLaunchHits: r.inferred_launch_hits,
  };
}

function parseTokenUsage(raw: string | null): Session["tokenUsage"] {
  if (!raw) return null;
  try { return JSON.parse(raw) as Session["tokenUsage"]; } catch { return null; }
}

export function upsertSession(db: Db, s: Session): void {
  db.prepare(
    `INSERT INTO sessions
       (id, project_dir, project_label, file_path, file_mtime, file_size,
        started_at, last_activity, git_branch, message_count, user_msg_count,
        compact_count, first_prompt, ai_title, cwd, token_usage,
        inferred_dir, inferred_hits, inferred_launch_hits, indexed_at)
     VALUES
       (@id, @projectDir, @projectLabel, @filePath, @fileMtime, @fileSize,
        @startedAt, @lastActivity, @gitBranch, @messageCount, @userMsgCount,
        @compactCount, @firstPrompt, @aiTitle, @cwd, @tokenUsage,
        @inferredDir, @inferredHits, @inferredLaunchHits, @indexedAt)
     ON CONFLICT(id) DO UPDATE SET
       project_dir   = excluded.project_dir,
       project_label = excluded.project_label,
       file_path     = excluded.file_path,
       file_mtime    = excluded.file_mtime,
       file_size     = excluded.file_size,
       started_at    = excluded.started_at,
       last_activity = excluded.last_activity,
       git_branch    = excluded.git_branch,
       message_count = excluded.message_count,
       user_msg_count = excluded.user_msg_count,
       compact_count = excluded.compact_count,
       first_prompt  = excluded.first_prompt,
       ai_title      = COALESCE(excluded.ai_title, sessions.ai_title),
       cwd           = excluded.cwd,
       token_usage   = excluded.token_usage,
       inferred_dir         = excluded.inferred_dir,
       inferred_hits        = excluded.inferred_hits,
       inferred_launch_hits = excluded.inferred_launch_hits,
       indexed_at    = excluded.indexed_at`
  ).run({
    ...s,
    tokenUsage: s.tokenUsage ? JSON.stringify(s.tokenUsage) : null,
    inferredDir: s.inferredDir ?? null,
    inferredHits: s.inferredHits ?? 0,
    inferredLaunchHits: s.inferredLaunchHits ?? 0,
  });
}

export function getSession(db: Db, id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRowSql | undefined;
  return row ? rowToSession(row) : null;
}

/** Fetch many sessions in one query, returned as a Map keyed by id (avoids N+1 round-trips). */
export function getSessionsByIds(db: Db, ids: string[]): Map<string, Session> {
  const out = new Map<string, Session>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const placeholders = unique.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM sessions WHERE id IN (${placeholders})`)
    .all(...unique) as SessionRowSql[];
  for (const row of rows) {
    const s = rowToSession(row);
    out.set(s.id, s);
  }
  return out;
}

/** Remove a session and everything keyed to it (messages cascade + FTS trigger; topic/label
 *  rows have no FK so are deleted explicitly). Used to evict ccaudit's own tool meta-sessions. */
export function deleteSession(db: Db, id: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(id); // fires the messages_fts trigger
    db.prepare("DELETE FROM topic_members WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM segment_labels WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  })();
}

/** Set a generated session title. Survives reindex via the COALESCE upsert. */
export function updateAiTitle(db: Db, id: string, title: string): void {
  db.prepare("UPDATE sessions SET ai_title = ? WHERE id = ?").run(title, id);
}

/** Sessions lacking a usable title (or all, when `force`), most-recent first. */
export function listSessionsNeedingTitle(
  db: Db,
  force = false
): Array<{ id: string; firstPrompt: string | null }> {
  const where = force ? "" : "WHERE ai_title IS NULL OR ai_title = ''";
  return db
    .prepare(`SELECT id, first_prompt AS firstPrompt FROM sessions ${where} ORDER BY last_activity DESC`)
    .all() as Array<{ id: string; firstPrompt: string | null }>;
}

export type ListSessionsOptions = {
  limit?: number;
  offset?: number;
  projectDir?: string;
};

export function listSessions(db: Db, opts: ListSessionsOptions = {}): Session[] {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const where: string[] = [];
  const params: Record<string, string | number> = { limit, offset };
  if (opts.projectDir) {
    where.push("project_dir = @projectDir");
    params.projectDir = opts.projectDir;
  }
  const excl = sessionKeepCondition(db);
  where.push(excl.sql);
  Object.assign(params, excl.params);
  const sql = `
    SELECT * FROM sessions
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY last_activity DESC, id DESC
    LIMIT @limit OFFSET @offset
  `;
  const rows = db.prepare(sql).all(params) as SessionRowSql[];
  return rows.map(rowToSession);
}

export function getSessionByFilePath(db: Db, filePath: string): Session | null {
  const row = db
    .prepare("SELECT * FROM sessions WHERE file_path = ?")
    .get(filePath) as SessionRowSql | undefined;
  return row ? rowToSession(row) : null;
}

export type ProjectSummary = {
  projectDir: string;
  projectLabel: string;
  sessionCount: number;
  lastActivity: number | null;
};

export function listProjects(db: Db): ProjectSummary[] {
  const excl = exclusionCondition(db);
  const rows = db
    .prepare(
      `SELECT project_dir   AS projectDir,
              project_label AS projectLabel,
              COUNT(*)      AS sessionCount,
              MAX(last_activity) AS lastActivity
         FROM sessions
        WHERE ${excl.sql}
        GROUP BY project_dir, project_label
        ORDER BY lastActivity DESC NULLS LAST, projectLabel ASC`
    )
    .all(excl.params) as ProjectSummary[];
  return rows;
}
