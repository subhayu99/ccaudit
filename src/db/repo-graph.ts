import type { Db } from "./init.js";
import type { GraphData, GraphNode, GraphLink } from "./graph.js";
import { listWorkdirs } from "./workdirs.js";
import { computeRepoComponents } from "../identity/components.js";
import { sessionKeepCondition } from "./exclusions.js";
import { rangeCondition, type DateRange } from "./date-range.js";

type SessionRow = {
  id: string;
  cwd: string | null;
  messageCount: number;
  compactCount: number;
  lastActivity: number | null;
  firstPrompt: string | null;
  aiTitle: string | null;
};

/** Last non-empty path segment. */
function basename(p: string): string {
  const segs = p.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1]! : p;
}

/**
 * Build a force-graph dataset pivoted on *logical repository identity*:
 *
 *   repo ──▶ workdir ──▶ session
 *
 * - Repo nodes are connected components of workdirs over shared commit-hash
 *   tokens (clones/worktrees of the same codebase collapse into one).
 * - Workdir nodes are the actual cwd paths a session ran in. The session
 *   carries its exact `cwd` so the resume command targets the right worktree.
 * - Sessions without a recorded cwd are omitted (they cannot be placed).
 */
export function getRepoGraphData(db: Db, range: DateRange | null = null): GraphData {
  const workdirs = listWorkdirs(db);
  const { repos, repoByPath } = computeRepoComponents(workdirs);
  const existsByPath = new Map(workdirs.map((w) => [w.path, w.existsOnDisk]));

  const excl = sessionKeepCondition(db);
  const rg = rangeCondition(range, "last_activity");
  const sessions = db
    .prepare(
      `SELECT id,
              cwd,
              message_count AS messageCount,
              compact_count AS compactCount,
              last_activity AS lastActivity,
              first_prompt  AS firstPrompt,
              ai_title      AS aiTitle
         FROM sessions
        WHERE cwd IS NOT NULL AND ${excl.sql} AND ${rg.sql}`
    )
    .all({ ...excl.params, ...rg.params }) as SessionRow[];

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // --- Workdir nodes + workdir→repo links ---
  // Only emit workdirs that have at least one (non-excluded) session. This also
  // drops workdirs whose sessions are all hidden by an exclusion.
  const sessionCwds = new Set(sessions.map((s) => s.cwd!));
  const visibleRepoIds = new Set<string>();
  const visibleWorkdirCount = new Map<string, number>();
  for (const w of workdirs) {
    if (!sessionCwds.has(w.path)) continue;
    const repoId = repoByPath.get(w.path);
    if (!repoId) continue;
    visibleRepoIds.add(repoId);
    visibleWorkdirCount.set(repoId, (visibleWorkdirCount.get(repoId) ?? 0) + 1);
    nodes.push({
      id: `workdir:${w.path}`,
      type: "workdir",
      label: basename(w.path),
      workdirPath: w.path,
      existsOnDisk: existsByPath.get(w.path) ?? false,
    });
    links.push({ source: `workdir:${w.path}`, target: `repo:${repoId}`, kind: "workdir-repo" });
  }

  // --- Repo nodes (only those with ≥1 visible workdir) ---
  for (const r of repos) {
    if (!visibleRepoIds.has(r.repoId)) continue;
    nodes.push({
      id: `repo:${r.repoId}`,
      type: "repo",
      label: r.displayName,
      remote: r.remote,
      workdirCount: visibleWorkdirCount.get(r.repoId) ?? r.workdirPaths.length,
    });
  }

  // --- Session nodes + session→workdir links ---
  const knownWorkdir = new Set(
    workdirs.filter((w) => sessionCwds.has(w.path)).map((w) => w.path)
  );
  for (const s of sessions) {
    if (!knownWorkdir.has(s.cwd!)) continue;
    const rawLabel = s.aiTitle ?? s.firstPrompt ?? s.id.slice(0, 8);
    const label = (rawLabel || s.id.slice(0, 8)).replace(/\s+/g, " ").trim();
    nodes.push({
      id: `sess:${s.id}`,
      type: "session",
      label,
      sessionId: s.id,
      cwd: s.cwd,
      messageCount: s.messageCount,
      compactCount: s.compactCount,
      lastActivity: s.lastActivity,
    });
    links.push({ source: `sess:${s.id}`, target: `workdir:${s.cwd}`, kind: "session-workdir" });
  }

  return { nodes, links };
}
