import type Database from "better-sqlite3";
import type { GraphData, GraphNode, GraphLink } from "./graph.js";
import { listTopics } from "./topics.js";
import { getLibraryTree } from "./library.js";

/**
 * Force-graph pivoted on TOPIC (the WHAT axis): topic ──▶ session.
 * Topic nodes sized by member count; sessions carry their title for hover/open.
 * Honors exclusions (sessions come from the visible library tree).
 */
export function getTopicGraphData(db: Database.Database): GraphData {
  const topics = listTopics(db);
  const tree = getLibraryTree(db);
  // visible session id -> {title, msgCount, compactCount, cwd, lastActivity}
  const sessions = new Map(
    tree.repos.flatMap((r) => r.workdirs.flatMap((w) => w.sessions.map((s) => [s.id, s] as const)))
  );
  const memberRows = db
    .prepare("SELECT topic_id AS tid, session_id AS sid FROM topic_members")
    .all() as Array<{ tid: number; sid: string }>;

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const emittedSession = new Set<string>();

  const visibleByTopic = new Map<number, string[]>();
  for (const { tid, sid } of memberRows) {
    if (!sessions.has(sid)) continue; // hidden/excluded
    visibleByTopic.set(tid, [...(visibleByTopic.get(tid) ?? []), sid]);
  }

  for (const t of topics) {
    const members = visibleByTopic.get(t.id) ?? [];
    if (members.length === 0) continue;
    nodes.push({ id: `topic:${t.id}`, type: "topic", label: t.name, sessionCount: members.length });
    for (const sid of members) {
      const s = sessions.get(sid)!;
      if (!emittedSession.has(sid)) {
        nodes.push({
          id: `sess:${sid}`,
          type: "session",
          label: s.title,
          sessionId: sid,
          cwd: s.workdirPath,
          messageCount: s.messageCount,
          compactCount: s.compactCount,
          lastActivity: s.lastActivity,
        });
        emittedSession.add(sid);
      }
      links.push({ source: `sess:${sid}`, target: `topic:${t.id}`, kind: "session-topic" });
    }
  }
  return { nodes, links };
}
