import type Database from "better-sqlite3";
import { sessionKeepCondition } from "./exclusions.js";

export type GraphNodeType = "folder" | "project" | "session" | "repo" | "workdir" | "topic";
export type GraphLinkKind =
  | "session-project"
  | "project-folder"
  | "continuation"
  | "session-workdir"
  | "workdir-repo"
  | "session-topic";

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  label: string;
  // session-only fields
  sessionId?: string;
  projectDir?: string;
  messageCount?: number;
  compactCount?: number;
  lastActivity?: number | null;
  // resume command needs the exact cwd the session ran in
  cwd?: string | null;
  // project-only fields
  sessionCount?: number;
  // folder-only fields
  folderPath?: string;
  projectCount?: number;
  // repo / workdir fields
  remote?: string | null;
  workdirPath?: string;
  workdirCount?: number;
  existsOnDisk?: boolean;
};

export type GraphLink = {
  source: string;
  target: string;
  kind: GraphLinkKind;
};

export type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

type ProjectRow = {
  projectDir: string;
  projectLabel: string;
  sessionCount: number;
};

type SessionRow = {
  id: string;
  projectDir: string;
  messageCount: number;
  compactCount: number;
  startedAt: number | null;
  lastActivity: number | null;
  firstPrompt: string | null;
  aiTitle: string | null;
};

/** Parent directory of a path (everything before the last "/"). */
function parentDir(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx > 0 ? p.slice(0, idx) : p;
}

/** Last n path segments joined with "/" — a compact display label. */
function shortPath(p: string, n = 2): string {
  return p.split("/").filter(Boolean).slice(-n).join("/");
}

/**
 * Build a multi-level force-graph dataset, Obsidian-style:
 *
 *   folder ──▶ project ──▶ session
 *
 * - One node per session, linked to its project (kind "session-project").
 * - One node per project (hub), sized by session count.
 * - One node per parent folder SHARED BY ≥2 projects, linking those projects
 *   together (kind "project-folder"). Projects with a unique parent stay top-level.
 * - Continuation links (kind "continuation") connect sessions within the same
 *   project in chronological order — the "threads" of related work. These are
 *   layout-neutral (the client renders them on demand but they don't pull the
 *   simulation), so toggling them never disturbs the layout.
 */
export function getGraphData(db: Database.Database): GraphData {
  const excl = sessionKeepCondition(db);
  const projects = db
    .prepare(
      `SELECT project_dir   AS projectDir,
              project_label AS projectLabel,
              COUNT(*)      AS sessionCount
         FROM sessions
        WHERE ${excl.sql}
        GROUP BY project_dir, project_label`
    )
    .all(excl.params) as ProjectRow[];

  const sessions = db
    .prepare(
      `SELECT id,
              project_dir   AS projectDir,
              message_count AS messageCount,
              compact_count AS compactCount,
              started_at    AS startedAt,
              last_activity AS lastActivity,
              first_prompt  AS firstPrompt,
              ai_title      AS aiTitle
         FROM sessions
        WHERE ${excl.sql}`
    )
    .all(excl.params) as SessionRow[];

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // --- Project nodes ---
  for (const p of projects) {
    nodes.push({
      id: `proj:${p.projectDir}`,
      type: "project",
      label: p.projectLabel,
      projectDir: p.projectDir,
      sessionCount: p.sessionCount,
    });
  }

  // --- Folder nodes (only for parents shared by ≥2 projects) ---
  const projectsByParent = new Map<string, string[]>();
  for (const p of projects) {
    const parent = parentDir(p.projectDir);
    const arr = projectsByParent.get(parent) ?? [];
    arr.push(p.projectDir);
    projectsByParent.set(parent, arr);
  }
  for (const [parent, projDirs] of projectsByParent) {
    if (projDirs.length < 2) continue;
    nodes.push({
      id: `folder:${parent}`,
      type: "folder",
      label: shortPath(parent, 2),
      folderPath: parent,
      projectCount: projDirs.length,
    });
    for (const pd of projDirs) {
      links.push({ source: `proj:${pd}`, target: `folder:${parent}`, kind: "project-folder" });
    }
  }

  // --- Session nodes + session→project links ---
  for (const s of sessions) {
    const rawLabel = s.aiTitle ?? s.firstPrompt ?? s.id.slice(0, 8);
    const label = (rawLabel || s.id.slice(0, 8)).replace(/\s+/g, " ").trim();
    nodes.push({
      id: `sess:${s.id}`,
      type: "session",
      label,
      sessionId: s.id,
      projectDir: s.projectDir,
      messageCount: s.messageCount,
      compactCount: s.compactCount,
      lastActivity: s.lastActivity,
    });
    links.push({ source: `sess:${s.id}`, target: `proj:${s.projectDir}`, kind: "session-project" });
  }

  // --- Continuation links: consecutive sessions within a project by time ---
  const sessionsByProject = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const arr = sessionsByProject.get(s.projectDir) ?? [];
    arr.push(s);
    sessionsByProject.set(s.projectDir, arr);
  }
  for (const arr of sessionsByProject.values()) {
    if (arr.length < 2) continue;
    const ordered = [...arr].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    for (let i = 1; i < ordered.length; i++) {
      links.push({
        source: `sess:${ordered[i - 1]!.id}`,
        target: `sess:${ordered[i]!.id}`,
        kind: "continuation",
      });
    }
  }

  return { nodes, links };
}
