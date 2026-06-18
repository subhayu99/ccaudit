import { join } from "node:path";
import type { Db } from "../db/init.js";
import type { Session } from "../types.js";
import { rehomeSession, type RehomeResult } from "./rehome.js";
import { CLAUDE_PROJECTS_DIR, CCAUDIT_DIR, projectLabel } from "../paths.js";

/**
 * The user-facing consent copy shown the first time a re-home is attempted. Re-home is
 * ccaudit's only write into ~/.claude, so every entry point (web /api/move, the MCP
 * `apply_session_moves` tool, the `move` CLI) shows this exact text before proceeding.
 */
export const REHOME_DISCLOSURE =
  "Re-home moves the real Claude session file in ~/.claude/projects/… and rewrites its " +
  "working directory — this changes Claude's data, not just ccaudit's index. The original is " +
  "backed up to ~/.ccaudit/backups/rehome/ first, and running sessions are never touched.";

export type ApplyRehomeOpts = {
  /** ~/.claude/projects (injectable for tests). */
  projectsRoot?: string;
  /** Where the byte-verified backup is written (injectable for tests). */
  backupDir?: string;
  /** Backup-filename timestamp (injectable for deterministic tests). */
  stamp?: string;
};

/**
 * Re-home a session on disk AND update its ccaudit index row to match — the single
 * code path shared by the web endpoint and the MCP batch tool, so they can never drift.
 *
 * Re-uses the safety-contracted `rehomeSession` (backup-first, no-clobber, verify before
 * delete) and then does a targeted row update: new project dir/label/cwd/file path, and
 * clears the misfiled flag (the session now lives where its work is). No full reindex on
 * the request path. Caller MUST have already confirmed the session is not running and
 * that the target directory exists.
 */
export function applyRehomeToDb(
  db: Db,
  session: Session,
  targetDir: string,
  opts: ApplyRehomeOpts = {}
): RehomeResult {
  const projectsRoot = opts.projectsRoot ?? CLAUDE_PROJECTS_DIR;
  const backupDir = opts.backupDir ?? join(CCAUDIT_DIR, "backups", "rehome");
  const stamp = opts.stamp ?? new Date().toISOString().replace(/[:.]/g, "-");

  const res = rehomeSession({
    sessionId: session.id,
    sourceFile: session.filePath,
    oldCwd: session.cwd ?? "",
    targetDir,
    projectsRoot,
    backupDir,
    stamp,
  });

  db.prepare(
    `UPDATE sessions
        SET project_dir = ?, project_label = ?, cwd = ?, file_path = ?,
            inferred_dir = NULL, inferred_hits = 0, inferred_launch_hits = 0
      WHERE id = ?`
  ).run(targetDir, projectLabel(targetDir), targetDir, res.targetFile, session.id);

  return res;
}
