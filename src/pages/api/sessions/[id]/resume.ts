import { existsSync } from "node:fs";
import type { APIRoute } from "astro";
import { getDb } from "../../../../db/init.js";
import { getSession } from "../../../../db/sessions.js";
import { buildResumeCommand } from "../../../../lib/resume.js";

export const GET: APIRoute = ({ params }) => {
  const id = params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: "missing id" }), { status: 400 });
  }
  const db = getDb();
  const session = getSession(db, id);
  if (!session) {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }
  // Only emit a `cd` line when we have a real, on-disk cwd. session.projectDir
  // is a lossy decode of the dir-hash and is NOT a safe filesystem path, so we
  // never shell out to it. POSIX-quote the cwd to prevent shell injection.
  const realCwd = session.cwd && existsSync(session.cwd) ? session.cwd : null;
  const command = buildResumeCommand(session.id, realCwd);
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
