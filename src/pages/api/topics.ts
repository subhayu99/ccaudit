import type { APIRoute } from "astro";
import { getDb } from "../../db/init.js";
import { renameTopic, deleteTopic, mergeTopics, findTopicByName, listTopics } from "../../db/topics.js";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  try { return (await request.json()) as Record<string, unknown>; } catch { return {}; }
}

// Rename a topic. If the new name matches another existing topic, MERGE this one into it instead.
export const PATCH: APIRoute = async ({ request }) => {
  const body = await readBody(request);
  const id = Number(body.id);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!Number.isFinite(id) || !name) return json({ error: "id and a non-empty name are required" }, 400);
  const db = getDb();
  const existing = findTopicByName(db, name, id);
  if (existing) {
    mergeTopics(db, [id], existing.id);
    return json({ topics: listTopics(db), merged: true, into: existing.name });
  }
  if (!renameTopic(db, id, name)) return json({ error: "rename failed" }, 409);
  return json({ topics: listTopics(db), renamed: true });
};

// Merge explicit source topics into a target.
export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request);
  const into = Number(body.into);
  const mergeIds = Array.isArray(body.mergeIds) ? body.mergeIds.map(Number).filter(Number.isFinite) : [];
  if (!Number.isFinite(into) || mergeIds.length === 0) return json({ error: "into and mergeIds are required" }, 400);
  const db = getDb();
  mergeTopics(db, mergeIds, into);
  return json({ topics: listTopics(db), merged: true });
};

export const DELETE: APIRoute = async ({ request }) => {
  const body = await readBody(request);
  const id = Number(body.id);
  if (!Number.isFinite(id)) return json({ error: "id is required" }, 400);
  const db = getDb();
  deleteTopic(db, id);
  return json({ topics: listTopics(db), deleted: true });
};
