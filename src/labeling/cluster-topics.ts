import { execFileSync } from "node:child_process";
import type { LabelRun } from "./label-segments.js";

export type TopicItem = { sessionId: string; title: string };
export type TopicCluster = { name: string; sessionIds: string[] };

export function buildClusterPrompt(items: TopicItem[]): string {
  const list = items.map((t, i) => `${i + 1}. ${t.title.replace(/\s+/g, " ").slice(0, 90)}`).join("\n");
  return (
    `Below are ${items.length} developer coding-session titles. Cluster them into a small set of ` +
    `higher-level TOPICS (the recurring projects/themes). Every session must belong to exactly one ` +
    `topic; use a "Miscellaneous" topic for one-offs. Output ONLY a JSON array of objects ` +
    `{"topic": "<short Title Case name>", "sessions": [<1-based item numbers>]}, sorted by size desc, ` +
    `max 18 topics.\n\n${list}`
  );
}

export function parseClusters(resultText: string, items: TopicItem[]): TopicCluster[] {
  let arr: unknown = null;
  const cleaned = resultText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { arr = JSON.parse(cleaned); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: TopicCluster[] = [];
  for (const t of arr as Array<{ topic?: unknown; sessions?: unknown }>) {
    const name = typeof t.topic === "string" ? t.topic.trim() : "";
    const nums = Array.isArray(t.sessions) ? t.sessions : [];
    const sessionIds = nums
      .map((n) => (typeof n === "number" ? items[n - 1]?.sessionId : undefined))
      .filter((x): x is string => typeof x === "string");
    if (name && sessionIds.length > 0) out.push({ name, sessionIds });
  }
  return out;
}

export const defaultClusterRun: LabelRun = (prompt) => {
  const raw = execFileSync(
    "claude",
    ["-p", prompt, "--model", "haiku", "--output-format", "json"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600_000 }
  );
  const o = JSON.parse(raw) as { result?: string; total_cost_usd?: number; is_error?: boolean };
  if (o.is_error) throw new Error("claude -p returned an error");
  return { result: o.result ?? "[]", costUsd: o.total_cost_usd ?? 0 };
};

export function clusterTopics(
  items: TopicItem[],
  opts: { run?: LabelRun } = {}
): { topics: TopicCluster[]; costUsd: number } {
  if (items.length === 0) return { topics: [], costUsd: 0 };
  const run = opts.run ?? defaultClusterRun;
  const { result, costUsd } = run(buildClusterPrompt(items));
  return { topics: parseClusters(result, items), costUsd };
}
