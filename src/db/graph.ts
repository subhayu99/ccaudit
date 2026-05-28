import type Database from "better-sqlite3";

export type GraphNode = {
  id: string;
  type: "project" | "session";
  label: string;
  // session-only fields
  sessionId?: string;
  projectDir?: string;
  messageCount?: number;
  compactCount?: number;
  lastActivity?: number | null;
  // project-only fields
  sessionCount?: number;
};

export type GraphLink = {
  source: string;
  target: string;
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
  lastActivity: number | null;
  firstPrompt: string | null;
  aiTitle: string | null;
};

/**
 * Build a force-graph dataset: one node per project (hub) + one node per session,
 * with each session linked to its project. Projects with more sessions become
 * larger gravity wells, giving an Obsidian-like clustered layout.
 */
export function getGraphData(db: Database.Database): GraphData {
  const projects = db
    .prepare(
      `SELECT project_dir   AS projectDir,
              project_label AS projectLabel,
              COUNT(*)      AS sessionCount
         FROM sessions
        GROUP BY project_dir, project_label`
    )
    .all() as ProjectRow[];

  const sessions = db
    .prepare(
      `SELECT id,
              project_dir   AS projectDir,
              message_count AS messageCount,
              compact_count AS compactCount,
              last_activity AS lastActivity,
              first_prompt  AS firstPrompt,
              ai_title      AS aiTitle
         FROM sessions`
    )
    .all() as SessionRow[];

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  for (const p of projects) {
    nodes.push({
      id: `proj:${p.projectDir}`,
      type: "project",
      label: p.projectLabel,
      projectDir: p.projectDir,
      sessionCount: p.sessionCount,
    });
  }

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
    links.push({ source: `sess:${s.id}`, target: `proj:${s.projectDir}` });
  }

  return { nodes, links };
}
