export function formatTimestamp(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Relative "time ago" with granularity that tapers as it gets older — fine when it's recent (and
 * might need attention), coarser once it's been a while:
 *   "just now" (<1m) · "Nm ago" · "Nh ago" · "Nd ago" (<7d) · then a short date ("May 24",
 *   or "Dec 25, 2025" across years).
 * Elapsed-based (not calendar day). `now` is injectable for testing. Full precision stays
 * available via formatTimestamp() in the element's title/tooltip.
 */
export function relativeTime(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return "—";
  const diff = Math.max(0, now - ms); // clamp future to "just now"
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `${MONTHS[d.getMonth()]} ${d.getDate()}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  const cleaned = s.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + "…";
}

export function shortSessionId(id: string): string {
  return id.slice(0, 8);
}
