import type { APIRoute } from "astro";
import { openDb } from "../../../../db/init.js";
import { getSession } from "../../../../db/sessions.js";
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
  const cwd = session.cwd ?? session.projectDir;
  const command = `cd ${cwd}\nclaude --resume ${session.id}`;
  return new Response(
    JSON.stringify({
      command,
      cwd,
      branch: session.gitBranch,
      lastActivity: session.lastActivity,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
