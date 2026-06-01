import type { APIRoute } from "astro";
import { existsSync } from "node:fs";
import { getDb } from "../../db/init.js";
import { readLiveRegistry } from "../../watch/registry.js";
import { listLive, indexedSessionIds } from "../../db/live-sessions.js";
import { getBootTime } from "../../lib/boot-time.js";

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

  // Running = fresh registry truth (fresh even between watcher ticks / no watcher), enriched from DB.
  const running = reg.map((inst) => {
    const d = dbById.get(inst.sessionId);
    const cwd = inst.cwd ?? d?.cwd ?? null;
    return {
      sessionId: inst.sessionId,
      name: inst.name ?? d?.name ?? null,
      cwd,
      cwdExists: !!cwd && existsSync(cwd),
      status: inst.status,
      startedAt: inst.startedAt ?? d?.startedAt ?? null,
      lastSeen: d?.lastSeen ?? inst.updatedAt ?? now,
      isIndexed: indexed.has(inst.sessionId),
    };
  });

  const recentlyEnded = history
    .filter((r) => r.endedAt !== null && !regIds.has(r.sessionId))
    .map((r) => ({
      sessionId: r.sessionId, name: r.name, cwd: r.cwd,
      cwdExists: !!r.cwd && existsSync(r.cwd),
      endedAt: r.endedAt, endedReason: r.endedReason, lastSeen: r.lastSeen,
      isIndexed: indexed.has(r.sessionId),
    }));

  return json({ running, recentlyEnded });
};
