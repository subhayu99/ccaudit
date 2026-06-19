import type { APIRoute } from "astro";
import { getDb } from "../../db/init.js";
import { toolListMismatchedSessions, toolApplySessionMoves } from "../../mcp/tools.js";

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

/** GET /api/misfiled[?hidden=1] → misfiled sessions (same source the MCP list tool uses). */
export const GET: APIRoute = ({ url }) =>
  json(toolListMismatchedSessions(getDb(), { limit: 1000, includeHidden: url.searchParams.get("hidden") === "1" }));

/**
 * POST /api/misfiled { moves: [{ sessionId, targetDir }], acknowledgeRisk? }
 * → batch re-home behind one consent gate. Reuses the same tool the MCP exposes, so the
 * web "Misfiled" page and Claude get identical behavior (running sessions skipped, etc.).
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { moves?: Array<{ sessionId: string; targetDir: string }>; acknowledgeRisk?: boolean };
  try { body = (await request.json()) as typeof body; } catch { return json({ error: "invalid body" }, 400); }
  const moves = Array.isArray(body.moves) ? body.moves : [];
  const result = toolApplySessionMoves(getDb(), { moves, acknowledgeRisk: !!body.acknowledgeRisk });
  return json(result);
};
