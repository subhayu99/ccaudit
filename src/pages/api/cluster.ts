import type { APIRoute } from "astro";
import { openDb } from "../../db/init.js";
import { getLibraryTree } from "../../db/library.js";
import { clusterTopics, type TopicItem } from "../../labeling/cluster-topics.js";
import { replaceTopics } from "../../db/topics.js";
import { INDEX_DB_PATH } from "../../paths.js";

/**
 * (Re)cluster all visible sessions into cross-session topics with one Claude
 * (Haiku) call (~3min, ~$0.08). Wholesale replace; same-origin JSON POST.
 */
export const POST: APIRoute = async () => {
  const db = openDb(INDEX_DB_PATH);
  const tree = getLibraryTree(db);
  const items: TopicItem[] = tree.repos.flatMap((r) =>
    r.workdirs.flatMap((w) => w.sessions.map((s) => ({ sessionId: s.id, title: s.title })))
  );
  if (items.length === 0) {
    db.close();
    return new Response(JSON.stringify({ topics: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  try {
    const { topics, costUsd } = clusterTopics(items);
    replaceTopics(db, topics);
    db.close();
    return new Response(JSON.stringify({ topics: topics.length, costUsd }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    db.close();
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500 });
  }
};
