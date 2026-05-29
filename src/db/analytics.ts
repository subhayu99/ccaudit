import type Database from "better-sqlite3";

export type DayActivity = {
  day: string; // "YYYY-MM-DD"
  sessions: number;
  messages: number;
};

export function getActivityByDay(db: Database.Database): DayActivity[] {
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
  return rows;
}

export type ToolUsage = {
  tool: string;
  count: number;
};

export function getToolUsage(db: Database.Database): ToolUsage[] {
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
  return [...counts.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);
}
