import type Database from "better-sqlite3";
import { modelCostUsd, type TokenUsage } from "../lib/pricing.js";

export type ModelSpend = { model: string; tokens: number; costUsd: number };
export type Spend = { totalCostUsd: number; totalTokens: number; byModel: ModelSpend[] };

/** Aggregate estimated AI spend across all indexed sessions, from captured per-model token usage. */
export function getSpend(db: Database.Database): Spend {
  const rows = db
    .prepare("SELECT token_usage FROM sessions WHERE token_usage IS NOT NULL")
    .all() as Array<{ token_usage: string }>;
  const byModel = new Map<string, { tokens: number; costUsd: number }>();
  let totalCostUsd = 0;
  let totalTokens = 0;
  for (const r of rows) {
    let usage: TokenUsage;
    try { usage = JSON.parse(r.token_usage) as TokenUsage; } catch { continue; }
    for (const [model, u] of Object.entries(usage)) {
      const tokens = u.input + u.output + u.cacheRead + u.cacheCreation;
      const cost = modelCostUsd(model, u);
      totalTokens += tokens;
      totalCostUsd += cost;
      const e = byModel.get(model) ?? { tokens: 0, costUsd: 0 };
      e.tokens += tokens;
      e.costUsd += cost;
      byModel.set(model, e);
    }
  }
  return {
    totalCostUsd,
    totalTokens,
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd),
  };
}

export type HistorySpan = { firstActivity: number | null; lastActivity: number | null; activeDays: number };

/** First/last session activity (epoch ms) and the count of distinct local calendar days
 *  with any activity — the "how long & how often" framing for the dashboard. */
export function getHistorySpan(db: Database.Database): HistorySpan {
  const row = db
    .prepare(
      `SELECT MIN(last_activity) AS first,
              MAX(last_activity) AS last,
              COUNT(DISTINCT date(last_activity/1000, 'unixepoch', 'localtime')) AS days
         FROM sessions
        WHERE last_activity IS NOT NULL`
    )
    .get() as { first: number | null; last: number | null; days: number };
  return { firstActivity: row.first, lastActivity: row.last, activeDays: row.days };
}

export type DayActivity = {
  day: string; // "YYYY-MM-DD"
  sessions: number;
  messages: number;
};

export type ToolUsage = {
  tool: string;
  count: number;
};

// These analyses are static between reindexes but expensive (getToolUsage scans
// + JSON-parses every assistant tool_use row). Memoize per process, keyed on the
// message-row count — a cheap, indexed signal that changes whenever the index is
// rebuilt. This keeps list/dashboard navigation snappy.
let _activity: { key: number; val: DayActivity[] } | null = null;
let _tools: { key: number; val: ToolUsage[] } | null = null;

function messageCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM messages").get() as { c: number }).c;
}

export function getActivityByDay(db: Database.Database): DayActivity[] {
  const key = messageCount(db);
  if (_activity && _activity.key === key) return _activity.val;
  const rows = db
    .prepare(
      `SELECT date(last_activity/1000, 'unixepoch', 'localtime') AS day,
              COUNT(*)                AS sessions,
              COALESCE(SUM(message_count), 0) AS messages
         FROM sessions
        WHERE last_activity IS NOT NULL
        GROUP BY day
        ORDER BY day ASC`
    )
    .all() as DayActivity[];
  _activity = { key, val: rows };
  return rows;
}

export function getToolUsage(db: Database.Database): ToolUsage[] {
  const key = messageCount(db);
  if (_tools && _tools.key === key) return _tools.val;

  // Only assistant messages can carry tool_use; pre-filter with LIKE to avoid
  // parsing every row.
  const rows = db
    .prepare(
      `SELECT raw_json FROM messages
        WHERE type = 'assistant' AND raw_json LIKE '%"tool_use"%'`
    )
    .all() as Array<{ raw_json: string }>;

  const counts = new Map<string, number>();
  for (const r of rows) {
    try {
      const raw = JSON.parse(r.raw_json);
      const content = raw?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part?.type === "tool_use") {
          const name = typeof part.name === "string" ? part.name : "unknown";
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    } catch {
      // skip unparseable
    }
  }
  const result = [...counts.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);
  _tools = { key, val: result };
  return result;
}
