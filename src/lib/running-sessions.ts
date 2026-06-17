import type { Db } from "../db/init.js";
import { readLiveRegistry } from "../watch/registry.js";
import { getBootTime } from "./boot-time.js";
import { indexedSessionIds } from "../db/live-sessions.js";

/**
 * Reorder `targets` so the ones that are running right now come first, preserving
 * each group's original (recency) order otherwise. Pure — returns a new array.
 *
 * Used so bulk renames title the live sessions before the long tail of old ones.
 */
export function prioritizeRunning<T extends { id: string }>(
  targets: T[],
  runningIds: Iterable<string>
): T[] {
  const running = new Set(runningIds);
  if (running.size === 0) return targets.slice();
  const front: T[] = [];
  const rest: T[] = [];
  for (const t of targets) (running.has(t.id) ? front : rest).push(t);
  return [...front, ...rest];
}

/**
 * Session IDs that are running right now (from the live registry) AND indexed — i.e.
 * have rows we can build a titling context from. Registry order, deduped.
 */
export function runningIndexedSessionIds(db: Db, now = Date.now()): string[] {
  const reg = readLiveRegistry({ bootTime: getBootTime(now) });
  const ids = reg.map((r) => r.sessionId);
  if (ids.length === 0) return [];
  const indexed = indexedSessionIds(db, ids);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (indexed.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
