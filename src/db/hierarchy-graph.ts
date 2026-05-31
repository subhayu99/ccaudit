import type Database from "better-sqlite3";
import type { GraphData } from "./graph.js";
import { getRepoGraphData } from "./repo-graph.js";
import { listTopics } from "./topics.js";

/**
 * The "ingrained" hierarchy view: repo ──▶ workdir(folder) ──▶ session, optionally with
 * session ──▶ topic as a last hop. Because it's a force graph (not strict containment), a topic
 * linked from sessions across different repos/folders becomes a cross-cutting connector — which is
 * the "interconnected topics" view. Reuses getRepoGraphData (shared `sess:<id>` node ids).
 */
export function getHierarchyGraphData(db: Database.Database, opts: { includeTopics?: boolean } = {}): GraphData {
  const base = getRepoGraphData(db);
  if (!opts.includeTopics) return base;

  const sessionNodeIds = new Set(base.nodes.filter((n) => n.type === "session").map((n) => n.id)); // "sess:<id>"
  const topicById = new Map(listTopics(db).map((t) => [t.id, t]));
  const members = db
    .prepare("SELECT topic_id AS tid, session_id AS sid FROM topic_members")
    .all() as Array<{ tid: number; sid: string }>;

  const nodes = [...base.nodes];
  const links = [...base.links];
  const countByTopic = new Map<number, number>();
  for (const { tid, sid } of members) {
    if (sessionNodeIds.has(`sess:${sid}`)) countByTopic.set(tid, (countByTopic.get(tid) ?? 0) + 1);
  }
  const emitted = new Set<number>();
  for (const { tid, sid } of members) {
    if (!sessionNodeIds.has(`sess:${sid}`)) continue;
    const t = topicById.get(tid);
    if (!t) continue;
    if (!emitted.has(tid)) {
      nodes.push({ id: `topic:${tid}`, type: "topic", label: t.name, sessionCount: countByTopic.get(tid) ?? 0 });
      emitted.add(tid);
    }
    links.push({ source: `sess:${sid}`, target: `topic:${tid}`, kind: "session-topic" });
  }
  return { nodes, links };
}
