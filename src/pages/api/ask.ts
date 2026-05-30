import type { APIRoute } from "astro";
import type Database from "better-sqlite3";
import { getDb } from "../../db/init.js";
import { searchMessages } from "../../db/messages.js";
import { getSessionsByIds } from "../../db/sessions.js";
import { answerFromExcerpts, type AskExcerpt } from "../../labeling/ask.js";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

type Source = { n: number; sessionId: string; lineNo: number; title: string; snippet: string };

/** FTS-retrieve the top spans for a question and shape them into excerpts + display sources. */
function retrieve(db: Database.Database, q: string): { excerpts: AskExcerpt[]; sources: Source[] } {
  const hits = searchMessages(db, q, { limit: 12, match: "any" });
  if (hits.length === 0) return { excerpts: [], sources: [] };
  const sessions = getSessionsByIds(db, hits.map((h) => h.sessionId));
  const getText = db.prepare("SELECT text_content FROM messages WHERE session_id = ? AND line_no = ?");
  const excerpts: AskExcerpt[] = hits
    .map((h) => {
      const row = getText.get(h.sessionId, h.lineNo) as { text_content: string | null } | undefined;
      const s = sessions.get(h.sessionId);
      const title = s?.aiTitle || s?.projectLabel || h.sessionId.slice(0, 8);
      return { n: 0, sessionId: h.sessionId, lineNo: h.lineNo, title, text: row?.text_content ?? "", snippet: h.snippet };
    })
    .filter((e) => e.text.trim());
  excerpts.forEach((e, i) => (e.n = i + 1));
  const sources: Source[] = excerpts.map((e) => ({
    n: e.n, sessionId: e.sessionId, lineNo: e.lineNo, title: e.title, snippet: (e as { snippet?: string }).snippet ?? "",
  }));
  return { excerpts, sources };
}

// Per-process answer cache, keyed by the normalized question, so repeats are instant + free.
type CacheEntry = { answer: string; sources: Source[]; costUsd: number; at: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_ENTRIES = 100;
const keyOf = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();
function getFresh(q: string): CacheEntry | null {
  const e = cache.get(keyOf(q));
  if (!e) return null;
  if (Date.now() - e.at < TTL_MS) return e;
  cache.delete(keyOf(q));
  return null;
}
function store(q: string, e: CacheEntry): void {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(keyOf(q), e);
}

export const POST: APIRoute = async ({ request }) => {
  let body: { q?: unknown; mode?: unknown };
  try { body = await request.json(); } catch { body = {}; }
  const q = typeof body.q === "string" ? body.q.trim() : "";
  if (!q) return json({ error: "empty query" }, 400);
  const db = getDb();

  // Phase 1: cheap retrieval, so the UI can show the matched chats while Claude is still thinking.
  if (body.mode === "retrieve") {
    try {
      const { sources } = retrieve(db, q);
      return json({ sources, cached: !!getFresh(q) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }

  // Phase 2: synthesize (served from cache when fresh).
  const hit = getFresh(q);
  if (hit) return json({ answer: hit.answer, sources: hit.sources, costUsd: 0, cached: true });

  try {
    const { excerpts, sources } = retrieve(db, q);
    if (excerpts.length === 0) {
      return json({ answer: "", sources: [], note: "No matching messages found in your history." });
    }
    const { answer, costUsd } = await answerFromExcerpts(q, excerpts);
    store(q, { answer, sources, costUsd, at: Date.now() });
    return json({ answer, sources, costUsd, cached: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = (e as { isTimeout?: boolean })?.isTimeout ? 504 : 400;
    return json({ error: message }, status);
  }
};
