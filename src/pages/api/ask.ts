import type { APIRoute } from "astro";
import { getDb } from "../../db/init.js";
import { searchMessages } from "../../db/messages.js";
import { getSessionsByIds } from "../../db/sessions.js";
import { answerFromExcerpts, type AskExcerpt } from "../../labeling/ask.js";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export const POST: APIRoute = async ({ request }) => {
  let body: { q?: unknown };
  try { body = await request.json(); } catch { body = {}; }
  const q = typeof body.q === "string" ? body.q.trim() : "";
  if (!q) return json({ error: "empty query" }, 400);

  const db = getDb();
  try {
    const hits = searchMessages(db, q, { limit: 12, match: "any" });
    if (hits.length === 0) {
      return json({ answer: "", sources: [], note: "No matching messages found in your history." });
    }
    const sessions = getSessionsByIds(db, hits.map((h) => h.sessionId));
    const getText = db.prepare("SELECT text_content FROM messages WHERE session_id = ? AND line_no = ?");
    const excerpts: AskExcerpt[] = hits
      .map((h, i) => {
        const row = getText.get(h.sessionId, h.lineNo) as { text_content: string | null } | undefined;
        const s = sessions.get(h.sessionId);
        const title = s?.aiTitle || s?.projectLabel || h.sessionId.slice(0, 8);
        return { n: i + 1, sessionId: h.sessionId, lineNo: h.lineNo, title, text: row?.text_content ?? "" };
      })
      .filter((e) => e.text.trim());
    if (excerpts.length === 0) {
      return json({ answer: "", sources: [], note: "Matches found but their text was empty." });
    }
    // Re-number after filtering so citations line up.
    excerpts.forEach((e, i) => (e.n = i + 1));

    const { answer, costUsd } = await answerFromExcerpts(q, excerpts);
    const sources = excerpts.map((e) => ({ n: e.n, sessionId: e.sessionId, lineNo: e.lineNo, title: e.title }));
    return json({ answer, sources, costUsd });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = (e as { isTimeout?: boolean })?.isTimeout ? 504 : 400;
    return json({ error: message }, status);
  }
};
