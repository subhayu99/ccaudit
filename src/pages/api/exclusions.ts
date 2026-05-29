import type { APIRoute } from "astro";
import { openDb } from "../../db/init.js";
import { addExclusion, removeExclusion } from "../../db/exclusions.js";
import { INDEX_DB_PATH } from "../../paths.js";

/**
 * Add or remove a hidden directory prefix. Same-origin JSON POST (the client
 * uses fetch); Astro's CSRF guard targets cross-site form posts, not JSON, so
 * this stays protected without disabling security. Hiding is lossless — indexed
 * rows are kept and just filtered from views — so this never triggers a reindex.
 */
export const POST: APIRoute = async ({ request }) => {
  let action = "";
  let prefix = "";
  try {
    const body = (await request.json()) as { action?: string; prefix?: string };
    action = String(body.action ?? "");
    prefix = String(body.prefix ?? "").trim();
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), { status: 400 });
  }

  if (!prefix || (action !== "add" && action !== "remove")) {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }

  const db = openDb(INDEX_DB_PATH);
  if (action === "add") addExclusion(db, prefix);
  else removeExclusion(db, prefix);
  db.close();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
