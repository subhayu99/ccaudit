import type { GraphData, GraphLink, GraphLinkKind, GraphNodeType } from "../db/graph.js";

/**
 * Obsidian-style node-type filtering with reconnect-through.
 *
 * The hierarchy graph is a forest: repo ◀── workdir ◀── session, plus a cross-cut
 * session ──▶ topic. When the user hides a *middle* layer (e.g. folders/workdirs), we don't
 * want the children to fall off the graph — each node re-links to its NEAREST still-visible
 * ancestor (session → repo when the workdir is hidden), so the graph stays connected.
 *
 * Topic links are independent of the structural chain: a session→topic edge survives iff both
 * endpoints are visible (a topic with no visible session simply floats).
 *
 * Pure + deterministic (no DB, no layout) so it can be unit-tested and re-run on every toggle.
 */
export function filterGraphByTypes(data: GraphData, visible: Set<string>): GraphData {
  // Parent maps, derived from the FULL link set (kinds, source/target are still ids here).
  const workdirOfSession = new Map<string, string>(); // sess id -> workdir id
  const repoOfWorkdir = new Map<string, string>(); // workdir id -> repo id
  const topicsOfSession = new Map<string, string[]>(); // sess id -> [topic id]
  for (const l of data.links) {
    const s = String(l.source), t = String(l.target);
    if (l.kind === "session-workdir") workdirOfSession.set(s, t);
    else if (l.kind === "workdir-repo") repoOfWorkdir.set(s, t);
    else if (l.kind === "session-topic") topicsOfSession.set(s, [...(topicsOfSession.get(s) ?? []), t]);
  }

  const isVisible = (type: GraphNodeType) => visible.has(type);
  const nodes = data.nodes.filter((n) => isVisible(n.type));
  const present = new Set(nodes.map((n) => n.id));

  const links: GraphLink[] = [];
  const seen = new Set<string>();
  const addLink = (source: string, target: string, kind: GraphLinkKind) => {
    if (!present.has(source) || !present.has(target)) return;
    const key = source + "|" + target;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source, target, kind });
  };

  for (const n of nodes) {
    if (n.type === "session") {
      const w = workdirOfSession.get(n.id);
      const r = w ? repoOfWorkdir.get(w) : undefined;
      // nearest visible structural ancestor: workdir, else bridge to repo
      if (w && present.has(w)) addLink(n.id, w, "session-workdir");
      else if (r && present.has(r)) addLink(n.id, r, "session-repo");
      // cross-cut topics
      for (const t of topicsOfSession.get(n.id) ?? []) addLink(n.id, t, "session-topic");
    } else if (n.type === "workdir") {
      const r = repoOfWorkdir.get(n.id);
      if (r && present.has(r)) addLink(n.id, r, "workdir-repo");
    }
  }

  return { nodes, links };
}
