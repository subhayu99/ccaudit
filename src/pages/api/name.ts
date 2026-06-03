import type { APIRoute } from "astro";
import { getDb } from "../../db/init.js";
import { listSessionsNeedingTitle, updateAiTitle, getSession } from "../../db/sessions.js";
import { nameSessions, type NameItem } from "../../labeling/name-sessions.js";
import { buildNameContext } from "../../labeling/name-context.js";
import { beginJob, endJob } from "../../lib/jobs.js";

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

/**
 * AI session titling. Same-origin JSON POST.
 *   { action: "smart" }       → title only sessions without one (never clobbers existing/edited titles)
 *   { action: "force" }       → regenerate titles for ALL sessions
 *   { action: "one", id }     → (re)title a single session with AI
 *   { action: "set", id, title } → manual rename (no AI), stored as the session's title
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { action?: string; id?: string; title?: string };
  try { body = (await request.json()) as typeof body; } catch { return json({ error: "invalid body" }, 400); }
  const action = String(body.action ?? "");
  const db = getDb();

  // Manual rename — no AI, instant.
  if (action === "set") {
    const id = String(body.id ?? "");
    const title = String(body.title ?? "").trim();
    if (!id || !title) return json({ error: "id and title required" }, 400);
    if (title.length > 200) return json({ error: "title too long" }, 400);
    if (!getSession(db, id)) return json({ error: "session not found" }, 404);
    updateAiTitle(db, id, title);
    return json({ ok: true, id, title });
  }

  // Bulk renames (smart/force) hold a process-wide lock so a second run can't start while one is
  // active and other pages can show it in progress. Single-session "one" is fast and not locked.
  let locked = false;
  try {
    let targets: { id: string; firstPrompt: string | null }[];
    if (action === "one") {
      const id = String(body.id ?? "");
      const s = id ? getSession(db, id) : null;
      if (!s) return json({ error: "session not found" }, 404);
      targets = [{ id: s.id, firstPrompt: s.firstPrompt ?? null }];
    } else if (action === "smart" || action === "force") {
      if (!beginJob("name")) return json({ error: "A renaming run is already in progress." }, 409);
      locked = true;
      targets = listSessionsNeedingTitle(db, action === "force");
    } else {
      return json({ error: "unknown action" }, 400);
    }
    if (targets.length === 0) return json({ ok: true, named: 0, total: 0, costUsd: 0 });

    const items: NameItem[] = targets.map((t) => ({ sessionId: t.id, context: buildNameContext(db, t.id, t.firstPrompt) }));
    let named = 0, costUsd = 0;
    const titles: Record<string, string> = {};
    const BATCH = 20;
    for (let i = 0; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH);
      const r = await nameSessions(chunk);
      costUsd += r.costUsd;
      chunk.forEach((it, j) => {
        const t = r.titles[j];
        if (t) { updateAiTitle(db, it.sessionId, t); titles[it.sessionId] = t; named += 1; }
      });
    }
    return json({ ok: true, named, total: targets.length, costUsd, title: action === "one" ? titles[targets[0]!.id] ?? null : undefined });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = (e as { isTimeout?: boolean })?.isTimeout ? 504 : 400;
    return json({ error: message }, status);
  } finally {
    if (locked) endJob("name");
  }
};
