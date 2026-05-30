import { execFileSync } from "node:child_process";
import type { Segment } from "../lib/segment.js";

export type LabelRun = (prompt: string) => { result: string; costUsd: number };

export function buildLabelPrompt(segments: Segment[]): string {
  const list = segments.map((s, i) => `${i + 1}. ${s.opener.replace(/\s+/g, " ").slice(0, 220)}`).join("\n");
  return (
    "You are labeling segments of a developer's Claude Code session. Each numbered item is the " +
    "opening user message of a distinct work-segment. Give each a concise 3-5 word topic label in " +
    "Title Case, no trailing punctuation. Output ONLY a JSON array of strings, one label per segment, " +
    "in the same order.\n\n" +
    list
  );
}

export function parseLabels(resultText: string, expected: number): string[] {
  let arr: unknown = null;
  const cleaned = resultText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { arr = JSON.parse(cleaned); } catch { arr = null; }
  const labels = Array.isArray(arr) ? arr.map((x) => (typeof x === "string" ? x.trim() : "")) : [];
  const out = labels.slice(0, expected);
  while (out.length < expected) out.push("");
  return out;
}

export const defaultLabelRun: LabelRun = (prompt) => {
  const raw = execFileSync(
    "claude",
    ["-p", prompt, "--model", "haiku", "--output-format", "json"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 180_000 }
  );
  const o = JSON.parse(raw) as { result?: string; total_cost_usd?: number; is_error?: boolean };
  if (o.is_error) throw new Error("claude -p returned an error");
  return { result: o.result ?? "[]", costUsd: o.total_cost_usd ?? 0 };
};

export function labelSegments(
  segments: Segment[],
  opts: { run?: LabelRun } = {}
): { labels: string[]; costUsd: number } {
  if (segments.length === 0) return { labels: [], costUsd: 0 };
  const run = opts.run ?? defaultLabelRun;
  const { result, costUsd } = run(buildLabelPrompt(segments));
  return { labels: parseLabels(result, segments.length), costUsd };
}
