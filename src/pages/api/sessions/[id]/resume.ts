import { existsSync } from "node:fs";
import type { APIRoute } from "astro";
import { openDb } from "../../../../db/init.js";
import { getSession } from "../../../../db/sessions.js";
import { posixQuote } from "../../../../lib/shell.js";
import { INDEX_DB_PATH } from "../../../../paths.js";

export const GET: APIRoute = ({ params }) => {
  const id = params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: "missing id" }), { status: 400 });
  }
  const db = openDb(INDEX_DB_PATH);
  const session = getSession(db, id);
  db.close();
  if (!session) {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }
  // Only emit a `cd` line when we have a real, on-disk cwd. session.projectDir
  // is a lossy decode of the dir-hash and is NOT a safe filesystem path, so we
  // never shell out to it. POSIX-quote the cwd to prevent shell injection.
  const realCwd = session.cwd && existsSync(session.cwd) ? session.cwd : null;
  const command = realCwd
    ? `cd ${posixQuote(realCwd)}\nclaude --resume ${session.id}`
    : `claude --resume ${session.id}  # original cwd unknown`;
  return new Response(
    JSON.stringify({
      command,
      cwd: realCwd,
      branch: session.gitBranch,
      lastActivity: session.lastActivity,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
