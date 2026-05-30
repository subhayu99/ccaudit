import type { APIRoute } from "astro";
import { getDb } from "../../db/init.js";
import { getLibraryTree } from "../../db/library.js";
import { clusterTopics, assignNewSessions, type TopicItem } from "../../labeling/cluster-topics.js";
import { replaceTopics, addToTopics, getClusteredSessionIds, listTopics } from "../../db/topics.js";

/**
 * Cluster sessions into cross-session topics with one Claude (Haiku) call.
 * Default = INCREMENTAL: only unclustered sessions are assigned into existing
 * topics (or new ones), merged in. `force: true` = full re-cluster from scratch.
 * Same-origin JSON POST.
 */
export const POST: APIRoute = async ({ request }) => {
  let force = false;
  try { force = !!((await request.json()) as { force?: boolean }).force; } catch { force = false; }

  const db = getDb();
  const tree = getLibraryTree(db);
  const allItems: TopicItem[] = tree.repos.flatMap((r) =>
    r.workdirs.flatMap((w) => w.sessions.map((s) => ({ sessionId: s.id, title: s.title })))
  );
  if (allItems.length === 0) {
    return new Response(JSON.stringify({ topics: 0, newlyClustered: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  try {
    if (force) {
      const { topics, costUsd } = await clusterTopics(allItems);
      // Never wipe existing topics on an empty/degenerate result. replaceTopics
      // DELETEs everything before inserting, so only commit a validated non-empty set.
      if (topics.length === 0) {
        return new Response(
          JSON.stringify({ error: "re-cluster produced no topics — existing topics left unchanged" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      replaceTopics(db, topics);
      const total = listTopics(db).length;
      return new Response(JSON.stringify({ topics: total, newlyClustered: allItems.length, costUsd, mode: "force" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const clustered = getClusteredSessionIds(db);
    const fresh = allItems.filter((i) => !clustered.has(i.sessionId));
    if (fresh.length === 0) {
      const total = listTopics(db).length;
      return new Response(JSON.stringify({ topics: total, newlyClustered: 0, costUsd: 0, mode: "incremental" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    const existingNames = listTopics(db).map((t) => t.name);
    const { topics, costUsd } = await assignNewSessions(fresh, existingNames);
    addToTopics(db, topics);
    const total = listTopics(db).length;
    return new Response(JSON.stringify({ topics: total, newlyClustered: fresh.length, costUsd, mode: "incremental" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Timeout -> 504; known CLI failures (missing CLI, non-zero exit, non-JSON) -> 400.
    const status = (e as { isTimeout?: boolean })?.isTimeout ? 504 : 400;
    return new Response(JSON.stringify({ error: message }), { status });
  }
};
