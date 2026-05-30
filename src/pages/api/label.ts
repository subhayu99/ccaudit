import type { APIRoute } from "astro";
import { openDb } from "../../db/init.js";
import { getSessionMessages } from "../../db/messages.js";
import { segmentSession } from "../../lib/segment.js";
import { labelSegments } from "../../labeling/label-segments.js";
import { spineHash, getLabels, saveLabels } from "../../db/labels.js";
import { INDEX_DB_PATH } from "../../paths.js";

/**
 * Name a session's segments with Claude. Same-origin JSON POST. Cached by spine
 * hash — returns instantly if already labeled for the current segmentation;
 * otherwise runs one `claude -p` (Haiku) call (~60s) and persists the result.
 */
export const POST: APIRoute = async ({ request }) => {
  let sessionId = "";
  try {
    const body = (await request.json()) as { sessionId?: string };
    sessionId = String(body.sessionId ?? "").trim();
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), { status: 400 });
  }
  if (!sessionId) return new Response(JSON.stringify({ error: "missing sessionId" }), { status: 400 });

  const db = openDb(INDEX_DB_PATH);
  const segments = segmentSession(getSessionMessages(db, sessionId));
  if (segments.length === 0) {
    db.close();
    return new Response(JSON.stringify({ labels: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const hash = spineHash(segments);
  const cached = getLabels(db, sessionId);
  if (cached && cached.spineHash === hash) {
    db.close();
    return new Response(JSON.stringify({ labels: cached.labels, cached: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { labels, costUsd } = labelSegments(segments);
    saveLabels(db, { sessionId, spineHash: hash, labels, model: "haiku", costUsd });
    db.close();
    return new Response(JSON.stringify({ labels, costUsd, cached: false }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    db.close();
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500 });
  }
};
