import type { APIRoute } from "astro";
import { getDb } from "../../db/init.js";
import { getSession } from "../../db/sessions.js";
import { getSessionMessages } from "../../db/messages.js";
import {
  renderSessionMarkdown,
  renderSessionHtml,
  exportFilename,
} from "../../lib/session-export.js";

/**
 * Download a session transcript as Markdown or HTML.
 *   GET /api/export?session=<id>&format=md|html[&raw=1]
 * Clean (conversation only) by default; raw=1 adds tool calls/results.
 */
export const GET: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get("session")?.trim();
  const format = (url.searchParams.get("format") ?? "md").toLowerCase();
  const raw = url.searchParams.get("raw") === "1";
  if (!sessionId) return new Response("missing ?session", { status: 400 });
  if (format !== "md" && format !== "html") {
    return new Response("format must be md or html", { status: 400 });
  }

  const db = getDb();
  const session = getSession(db, sessionId);
  if (!session) return new Response("session not found", { status: 404 });
  const messages = getSessionMessages(db, sessionId);

  const filename = exportFilename(session, format);
  const disposition = `attachment; filename="${filename}"`;

  if (format === "html") {
    const html = await renderSessionHtml(session, messages, { raw });
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": disposition },
    });
  }
  const md = renderSessionMarkdown(session, messages, { raw });
  return new Response(md, {
    status: 200,
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": disposition },
  });
};
