/**
 * Global date-range filter. A small token is persisted in a cookie (`ccaudit-range`) and read
 * by every server-rendered page; it scopes the session list, search, Ask, and dashboard to
 * sessions whose activity falls in the window. "all" / absent = no filter (the default).
 *
 * Pure + deterministic (now is injected) so it unit-tests cleanly.
 */
export type DateRange = { from: number; to: number };

const DAY = 86_400_000;
const PRESETS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Resolve a stored token into a concrete [from,to] window, or null for "all time". */
export function resolveRange(token: string | undefined | null, now: number): DateRange | null {
  if (!token || token === "all") return null;
  if (token in PRESETS) return { from: now - PRESETS[token]! * DAY, to: now };
  if (token.startsWith("custom:")) {
    const [, f, t] = token.split(":");
    const from = Number(f), to = Number(t);
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) return { from, to };
  }
  return null;
}

/**
 * A SQL boolean (named params @rgFrom/@rgTo) that is TRUE for rows inside the window.
 * Returns the always-true sentinel `"1"` when there's no range. AND-able into a WHERE.
 */
export function rangeCondition(range: DateRange | null, col = "last_activity"): { sql: string; params: Record<string, number> } {
  if (!range) return { sql: "1", params: {} };
  return { sql: `(${col} >= @rgFrom AND ${col} <= @rgTo)`, params: { rgFrom: range.from, rgTo: range.to } };
}

/** Human-readable label for the active-range chip. */
export function rangeLabel(token: string | undefined | null): string {
  if (!token || token === "all") return "All time";
  if (token === "7d") return "Last 7 days";
  if (token === "30d") return "Last 30 days";
  if (token === "90d") return "Last 90 days";
  if (token.startsWith("custom:")) {
    const [, f, t] = token.split(":");
    const d = (ms: string) => new Date(Number(ms)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${d(f!)} – ${d(t!)}`;
  }
  return "All time";
}
