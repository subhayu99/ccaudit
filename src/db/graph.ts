import type Database from "better-sqlite3";
import { sessionKeepCondition } from "./exclusions.js";

export type GraphNodeType = "folder" | "project" | "session" | "repo" | "workdir" | "topic";
export type GraphLinkKind =
  | "session-project"
  | "project-folder"
  | "continuation"
  | "session-workdir"
  | "workdir-repo"
  | "session-repo"
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

/**
 * Bound the graph payload: keep only the `perHub` most-recent session leaves under each hub
 * (hubs retain their full sessionCount; click a hub to open its complete list). This keeps the
 * force simulation responsive on large graphs without dropping any hub.
 * Returns { data, droppedSessions } so callers can surface what was collapsed.
 */
export function capSessionsPerHub(data: GraphData, perHub: number): { data: GraphData; droppedSessions: number } {
  const isSession = new Set(data.nodes.filter((n) => n.type === "session").map((n) => n.id));
  // Each session links to exactly one hub — the non-session endpoint.
  const hubOf = new Map<string, string>();
  for (const l of data.links) {
    if (isSession.has(l.source) && !isSession.has(l.target)) hubOf.set(l.source, l.target);
    else if (isSession.has(l.target) && !isSession.has(l.source)) hubOf.set(l.target, l.source);
  }
  const lastActivity = new Map(data.nodes.map((n) => [n.id, n.lastActivity ?? 0]));
  const byHub = new Map<string, string[]>();
  for (const id of isSession) {
    const hub = hubOf.get(id) ?? "__nohub__";
    if (!byHub.has(hub)) byHub.set(hub, []);
    byHub.get(hub)!.push(id);
  }
  const drop = new Set<string>();
  for (const ids of byHub.values()) {
    if (ids.length <= perHub) continue;
    ids.sort((a, b) => (lastActivity.get(b) ?? 0) - (lastActivity.get(a) ?? 0));
    for (const id of ids.slice(perHub)) drop.add(id);
  }
  if (drop.size === 0) return { data, droppedSessions: 0 };
  const nodes = data.nodes.filter((n) => !drop.has(n.id));
  const links = data.links.filter((l) => !drop.has(l.source) && !drop.has(l.target));
  return { data: { nodes, links }, droppedSessions: drop.size };
}

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
