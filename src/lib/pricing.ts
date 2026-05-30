// Estimated Claude API pricing. Claude Code logs token counts per assistant message but no cost,
// so we compute an ESTIMATE from published per-million-token rates. Rates are approximate and
// matched by model family (opus / sonnet / haiku); cache-creation is billed at the cache-write
// rate (we don't split the 1h vs 5m ephemeral buckets). Treat displayed costs as estimates.

export type ModelUsage = { input: number; output: number; cacheRead: number; cacheCreation: number };
/** Per-session token totals, keyed by model id (e.g. "claude-opus-4-7"). */
export type TokenUsage = Record<string, ModelUsage>;

/** USD per 1,000,000 tokens. */
type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number };

const RATES: Record<"opus" | "sonnet" | "haiku", Rate> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Map a model id to a rate family. Unknown/synthetic models fall back to sonnet (a mid estimate). */
function rateFor(model: string): Rate {
  const m = model.toLowerCase();
  if (m.includes("opus")) return RATES.opus;
  if (m.includes("haiku")) return RATES.haiku;
  return RATES.sonnet; // sonnet, unknown, or anything else
}

export function emptyModelUsage(): ModelUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

/** Cost of one model's usage, in USD. */
export function modelCostUsd(model: string, u: ModelUsage): number {
  const r = rateFor(model);
  return (
    (u.input * r.input +
      u.output * r.output +
      u.cacheRead * r.cacheRead +
      u.cacheCreation * r.cacheWrite) /
    1_000_000
  );
}

/** Estimated total cost (USD) of a session's per-model token usage. */
export function sessionCostUsd(usage: TokenUsage | null | undefined): number {
  if (!usage) return 0;
  let total = 0;
  for (const [model, u] of Object.entries(usage)) total += modelCostUsd(model, u);
  return total;
}

/** Sum of every token type across all models (for a "tokens" display). */
export function totalTokens(usage: TokenUsage | null | undefined): number {
  if (!usage) return 0;
  let n = 0;
  for (const u of Object.values(usage)) n += u.input + u.output + u.cacheRead + u.cacheCreation;
  return n;
}

/** The model that accounts for the most tokens (for a primary-model label). */
export function primaryModel(usage: TokenUsage | null | undefined): string | null {
  if (!usage) return null;
  let best: string | null = null;
  let bestN = -1;
  for (const [model, u] of Object.entries(usage)) {
    const n = u.input + u.output + u.cacheRead + u.cacheCreation;
    if (n > bestN) { bestN = n; best = model; }
  }
  return best;
}

/** Format a USD amount compactly: $0.0042, $1.23, $45. */
export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString()}`;
}
