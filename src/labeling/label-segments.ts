import type { Segment } from "../lib/segment.js";
import { runClaude, parseClaudeJson } from "./run-claude.js";

export type LabelResult = { result: string; costUsd: number };
/** A runner may be sync (test fakes) or async (real `claude -p`); callers always await. */
export type LabelRun = (prompt: string) => LabelResult | Promise<LabelResult>;

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

export const defaultLabelRun: LabelRun = async (prompt) => {
  const raw = await runClaude(
    ["-p", prompt, "--model", "haiku", "--output-format", "json"],
    { timeoutMs: 180_000, maxBuffer: 16 * 1024 * 1024 }
  );
  const o = parseClaudeJson(raw);
  if (o.is_error) throw new Error("claude -p returned an error");
  return { result: o.result ?? "[]", costUsd: o.total_cost_usd ?? 0 };
};

export async function labelSegments(
  segments: Segment[],
  opts: { run?: LabelRun } = {}
): Promise<{ labels: string[]; costUsd: number }> {
  if (segments.length === 0) return { labels: [], costUsd: 0 };
  const run = opts.run ?? defaultLabelRun;
  const { result, costUsd } = await run(buildLabelPrompt(segments));
  return { labels: parseLabels(result, segments.length), costUsd };
}
