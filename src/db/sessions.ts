import type Database from "better-sqlite3";
import type { Session } from "../types.js";

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
  };
}

export function upsertSession(db: Database.Database, s: Session): void {
  db.prepare(
    `INSERT INTO sessions
       (id, project_dir, project_label, file_path, file_mtime, file_size,
        started_at, last_activity, git_branch, message_count, user_msg_count,
        compact_count, first_prompt, ai_title, cwd, indexed_at)
     VALUES
       (@id, @projectDir, @projectLabel, @filePath, @fileMtime, @fileSize,
        @startedAt, @lastActivity, @gitBranch, @messageCount, @userMsgCount,
        @compactCount, @firstPrompt, @aiTitle, @cwd, @indexedAt)
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
       ai_title      = excluded.ai_title,
       cwd           = excluded.cwd,
       indexed_at    = excluded.indexed_at`
  ).run(s);
}

export function getSession(db: Database.Database, id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRowSql | undefined;
  return row ? rowToSession(row) : null;
}

export type ListSessionsOptions = {
  limit?: number;
  offset?: number;
  projectDir?: string;
};

export function listSessions(db: Database.Database, opts: ListSessionsOptions = {}): Session[] {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const where: string[] = [];
  const params: Record<string, unknown> = { limit, offset };
  if (opts.projectDir) {
    where.push("project_dir = @projectDir");
    params.projectDir = opts.projectDir;
  }
  const sql = `
    SELECT * FROM sessions
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY last_activity DESC, id DESC
    LIMIT @limit OFFSET @offset
  `;
  const rows = db.prepare(sql).all(params) as SessionRowSql[];
  return rows.map(rowToSession);
}

export function getSessionByFilePath(db: Database.Database, filePath: string): Session | null {
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

export function listProjects(db: Database.Database): ProjectSummary[] {
  const rows = db
    .prepare(
      `SELECT project_dir   AS projectDir,
              project_label AS projectLabel,
              COUNT(*)      AS sessionCount,
              MAX(last_activity) AS lastActivity
         FROM sessions
        GROUP BY project_dir, project_label
        ORDER BY lastActivity DESC NULLS LAST, projectLabel ASC`
    )
    .all() as ProjectSummary[];
  return rows;
}
