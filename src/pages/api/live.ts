import type { APIRoute } from "astro";
import { existsSync } from "node:fs";
import { getDb } from "../../db/init.js";
import { readLiveRegistry } from "../../watch/registry.js";
import { listLive, indexedSessionIds } from "../../db/live-sessions.js";
import { getBootTime } from "../../lib/boot-time.js";
import { cleanSessionName } from "../../lib/clean-prompt.js";
import { listExclusions, isExcludedPath } from "../../db/exclusions.js";
import { runningJobs } from "../../lib/jobs.js";

const DAY = 86_400_000;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export const GET: APIRoute = () => {
  const now = Date.now();
  const db = getDb();
  const reg = readLiveRegistry({ bootTime: getBootTime(now) });
  const regIds = new Set(reg.map((r) => r.sessionId));
  const history = listLive(db, { endedSince: now - DAY });
  const dbById = new Map(history.map((r) => [r.sessionId, r]));

  const allIds = [...new Set([...reg.map((r) => r.sessionId), ...history.map((r) => r.sessionId)])];
  const indexed = indexedSessionIds(db, allIds);
  // Hidden directories: drop their sessions from both lists (parity with the /live page + graph).
  const exPrefixes = listExclusions(db);
  const hidden = (cwd: string | null) => !!cwd && isExcludedPath(cwd, exPrefixes);

  // Running = fresh registry truth (fresh even between watcher ticks / no watcher), enriched from DB.
  const running = reg.map((inst) => {
    const d = dbById.get(inst.sessionId);
    const cwd = inst.cwd ?? d?.cwd ?? null;
    return {
      sessionId: inst.sessionId,
      name: cleanSessionName(inst.name ?? d?.name) || null,
      cwd,
      cwdExists: !!cwd && existsSync(cwd),
      status: inst.status,
      startedAt: inst.startedAt ?? d?.startedAt ?? null,
      lastSeen: d?.lastSeen ?? inst.updatedAt ?? now,
      isIndexed: indexed.has(inst.sessionId),
    };
  }).filter((r) => !hidden(r.cwd));

  const recentlyEnded = history
    .filter((r) => r.endedAt !== null && !regIds.has(r.sessionId) && !hidden(r.cwd))
    .map((r) => ({
      sessionId: r.sessionId, name: cleanSessionName(r.name) || null, cwd: r.cwd,
      cwdExists: !!r.cwd && existsSync(r.cwd),
      endedAt: r.endedAt, endedReason: r.endedReason, lastSeen: r.lastSeen,
      isIndexed: indexed.has(r.sessionId),
    }));

  return json({ running, recentlyEnded, jobs: runningJobs() });
};
