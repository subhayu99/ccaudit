import type Database from "better-sqlite3";

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
