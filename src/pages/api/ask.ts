import type { APIRoute } from "astro";
import type Database from "better-sqlite3";
import { getDb } from "../../db/init.js";
import { searchMessages } from "../../db/messages.js";
import { getSessionsByIds } from "../../db/sessions.js";
import { answerFromExcerpts, contentTerms, isLowSignalExcerpt, type AskExcerpt } from "../../labeling/ask.js";
import type { SearchHit } from "../../types.js";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

type Source = { n: number; sessionId: string; lineNo: number; title: string; snippet: string };
const MAX_EXCERPTS = 10;
const MAX_PER_SESSION = 2;
const RAG_TYPES = ["user", "assistant"]; // skip tool output / attachments / meta lines

/** Retrieve relevant spans for a question: meaningful terms only (stopwords stripped), AND-first
 *  then OR-broaden, restricted to real turns, with file-dump noise filtered and sessions diversified. */
function retrieve(db: Database.Database, q: string): { excerpts: AskExcerpt[]; sources: Source[] } {
  const cleaned = contentTerms(q).join(" ");
  const opts = { limit: 30, types: RAG_TYPES };
  let hits: SearchHit[] = cleaned ? searchMessages(db, cleaned, { ...opts, match: "all" }) : [];
  if (hits.length < 4) {
    // Too few precise matches — broaden to any-term (still only meaningful terms), append + dedup.
    const broad = cleaned
      ? searchMessages(db, cleaned, { ...opts, match: "any" })
      : searchMessages(db, q, { ...opts, match: "any" });
    const seen = new Set(hits.map((h) => `${h.sessionId}:${h.lineNo}`));
    for (const h of broad) {
      const k = `${h.sessionId}:${h.lineNo}`;
      if (!seen.has(k)) { seen.add(k); hits.push(h); }
    }
  }
  if (hits.length === 0) return { excerpts: [], sources: [] };

  const sessions = getSessionsByIds(db, hits.map((h) => h.sessionId));
  const getText = db.prepare("SELECT text_content FROM messages WHERE session_id = ? AND line_no = ?");
  const perSession = new Map<string, number>();
  const excerpts: AskExcerpt[] = [];
  for (const h of hits) {
    if (excerpts.length >= MAX_EXCERPTS) break;
    const row = getText.get(h.sessionId, h.lineNo) as { text_content: string | null } | undefined;
    const text = (row?.text_content ?? "").trim();
    if (!text || isLowSignalExcerpt(text)) continue;
    const used = perSession.get(h.sessionId) ?? 0;
    if (used >= MAX_PER_SESSION) continue; // diversify across sessions
    perSession.set(h.sessionId, used + 1);
    const s = sessions.get(h.sessionId);
    const title = s?.aiTitle || s?.projectLabel || h.sessionId.slice(0, 8);
    excerpts.push({ n: excerpts.length + 1, sessionId: h.sessionId, lineNo: h.lineNo, title, text, snippet: h.snippet });
  }
  const sources: Source[] = excerpts.map((e) => ({
    n: e.n, sessionId: e.sessionId, lineNo: e.lineNo, title: e.title, snippet: e.snippet ?? "",
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
