import type { APIRoute } from "astro";
import { getDb } from "../../db/init.js";
import { searchMessages } from "../../db/messages.js";
import { getSessionsByIds } from "../../db/sessions.js";
import { resolveRange } from "../../db/date-range.js";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

const HIT_LIMIT = 120; // total matched lines pulled; grouped client-side into collapsible sessions

/**
 * Live search for the ⌘K palette. Returns matched message lines grouped by session, with each
 * session's title + a short path label so the palette can render collapsible groups without
 * needing the session in its (capped) jump-index. Mirrors the /search page's full-text behavior.
 */
export const GET: APIRoute = ({ url, cookies }) => {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return json({ q, total: 0, groups: [] });
  try {
    const db = getDb();
    const range = resolveRange(cookies.get("ccaudit-range")?.value, Date.now());
    const hits = searchMessages(db, q, { limit: HIT_LIMIT, match: "all", range });
    if (hits.length === 0) return json({ q, total: 0, groups: [] });

    const sessions = getSessionsByIds(db, hits.map((h) => h.sessionId));
    // Group by session, preserving best-rank session order (hits are rank-ordered).
    const order: string[] = [];
    const byId = new Map<string, Array<{ lineNo: number; snippet: string }>>();
    for (const h of hits) {
      if (!byId.has(h.sessionId)) { byId.set(h.sessionId, []); order.push(h.sessionId); }
      byId.get(h.sessionId)!.push({ lineNo: h.lineNo, snippet: h.snippet });
    }
    const groups = order.map((sessionId) => {
      const s = sessions.get(sessionId);
      const title = (s?.aiTitle || s?.firstPrompt || sessionId.slice(0, 8)).replace(/\s+/g, " ").trim();
      const sub = s?.projectLabel ?? "";
      const lines = byId.get(sessionId)!.sort((a, b) => a.lineNo - b.lineNo);
      return { sessionId, title, sub, count: lines.length, lines };
    });
    return json({ q, total: hits.length, groups });
  } catch (e) {
    return json({ q, total: 0, groups: [], error: e instanceof Error ? e.message : String(e) }, 500);
  }
};
