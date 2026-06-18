import type { APIRoute } from "astro";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { getDb } from "../../db/init.js";
import { getSession } from "../../db/sessions.js";
import { getSessionMessages } from "../../db/messages.js";
import { CLAUDE_PROJECTS_DIR, CCAUDIT_DIR } from "../../paths.js";
import { readConfig, writeConfig } from "../../lib/config.js";
import { readLiveRegistry } from "../../watch/registry.js";
import { getBootTime } from "../../lib/boot-time.js";
import { suggestSessionHome } from "../../lib/session-dirs.js";
import { rehomeSession } from "../../lib/rehome.js";

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

const DISCLOSURE =
  "Re-home moves the real Claude session file in ~/.claude/projects/… and rewrites its " +
  "working directory — this changes Claude's data, not just ccaudit's index. The original is " +
  "backed up to ~/.ccaudit/backups/rehome/ first, and running sessions are never touched.";

function runningIds(): Set<string> {
  return new Set(readLiveRegistry({ bootTime: getBootTime(Date.now()) }).map((r) => r.sessionId));
}

/** GET /api/move?session=<id> → suggested target dirs + state for the picker. */
export const GET: APIRoute = ({ url }) => {
  const id = url.searchParams.get("session")?.trim();
  if (!id) return json({ error: "missing ?session" }, 400);
  const db = getDb();
  const s = getSession(db, id);
  if (!s) return json({ error: "session not found" }, 404);
  const suggestions = suggestSessionHome(getSessionMessages(db, id), { currentDir: s.cwd });
  return json({
    sessionId: id,
    currentDir: s.cwd,
    running: runningIds().has(id),
    consentGiven: readConfig().rehomeConsent === "accepted",
    disclosure: DISCLOSURE,
    suggestions: suggestions.map((x) => ({ dir: x.dir, hits: x.hits })),
  });
};

/** POST /api/move { sessionId, targetDir, acknowledgeRisk? } → re-home (writes ~/.claude). */
export const POST: APIRoute = async ({ request }) => {
  let body: { sessionId?: string; targetDir?: string; acknowledgeRisk?: boolean };
  try { body = (await request.json()) as typeof body; } catch { return json({ error: "invalid body" }, 400); }
  const sessionId = String(body.sessionId ?? "");
  const targetDir = String(body.targetDir ?? "");
  if (!sessionId || !targetDir) return json({ error: "sessionId and targetDir required" }, 400);

  const db = getDb();
  const s = getSession(db, sessionId);
  if (!s) return json({ error: "session not found" }, 404);
  if (runningIds().has(sessionId)) return json({ error: "That session is currently running — close it first." }, 409);
  if (!existsSync(targetDir)) return json({ error: `target directory doesn't exist: ${targetDir}` }, 400);

  // One-time consent gate before any write to ~/.claude.
  if (readConfig().rehomeConsent !== "accepted") {
    if (!body.acknowledgeRisk) return json({ consentRequired: true, disclosure: DISCLOSURE });
    writeConfig({ rehomeConsent: "accepted" });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    const res = rehomeSession({
      sessionId,
      sourceFile: s.filePath,
      oldCwd: s.cwd ?? "",
      targetDir,
      projectsRoot: CLAUDE_PROJECTS_DIR,
      backupDir: join(CCAUDIT_DIR, "backups", "rehome"),
      stamp,
    });
    // Fast, targeted re-grouping (a full reindex would re-sync the stored raw_json later).
    db.prepare("UPDATE sessions SET project_dir = ?, cwd = ?, file_path = ? WHERE id = ?")
      .run(targetDir, targetDir, res.targetFile, sessionId);
    return json({ ok: true, movedTo: targetDir, file: res.targetFile, backup: res.backupFile, linesRewritten: res.linesRewritten });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};
