// Estimated Claude API pricing. Claude Code logs token counts per assistant message but no cost,
// so we compute an ESTIMATE from published per-million-token rates. Rates are approximate and
// matched by model family (opus / sonnet / haiku); cache-creation is billed at the cache-write
// rate (we don't split the 1h vs 5m ephemeral buckets). Treat displayed costs as estimates.

export type ModelUsage = { input: number; output: number; cacheRead: number; cacheCreation: number };
/** Per-session token totals, keyed by model id (e.g. "claude-opus-4-7"). */
export type TokenUsage = Record<string, ModelUsage>;

/** USD per 1,000,000 tokens. */
type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number | null };

const RATES: Record<"opus" | "sonnet" | "haiku", Rate> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

// OpenAI standard, short-context API estimates, checked 2026-09-26:
// https://developers.openai.com/api/docs/pricing and /api/docs/models/<model>.
// Excludes service-tier/long-context multipliers and subscription billing.
const OPENAI_RATES: Record<string, Rate> = {
  "gpt-6-astra": { input: 10, cacheRead: 1, cacheWrite: 12.5, output: 50 },
  "gpt-6-sol": { input: 2, cacheRead: .2, cacheWrite: 2.5, output: 10 },
  "gpt-6-luna": { input: .1, cacheRead: .01, cacheWrite: .125, output: .5 },
  "gpt-5.6-sol": { input: 4, cacheRead: .4, cacheWrite: 5, output: 20 },
  "gpt-5.6-terra": { input: 2, cacheRead: .2, cacheWrite: 2.5, output: 12 },
  "gpt-5.6-luna": { input: .2, cacheRead: .02, cacheWrite: .25, output: 1.2 },
  "gpt-5.5": { input: 5, cacheRead: .5, cacheWrite: null, output: 30 },
  "gpt-5.4": { input: 2.5, cacheRead: .25, cacheWrite: null, output: 15 },
  "gpt-5.4-mini": { input: .75, cacheRead: .075, cacheWrite: null, output: 4.5 },
  "gpt-5.4-nano": { input: .2, cacheRead: .02, cacheWrite: null, output: 1.25 },
  "gpt-5.3-codex": { input: 1.75, cacheRead: .175, cacheWrite: null, output: 14 },
  "gpt-5.2-codex": { input: 1.75, cacheRead: .175, cacheWrite: null, output: 14 },
  "gpt-5.1-codex": { input: 1.25, cacheRead: .125, cacheWrite: null, output: 10 },
};

function rateFor(model: string): Rate | null {
  const m = model.toLowerCase();
  const openai = OPENAI_RATES[m] ?? OPENAI_RATES[m.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  if (openai) return openai;
  if (m.startsWith("claude-") && m.includes("opus")) return RATES.opus;
  if (m.startsWith("claude-") && m.includes("haiku")) return RATES.haiku;
  if (m.startsWith("claude-") && m.includes("sonnet")) return RATES.sonnet;
  return null;
}

/** Unknown prices are excluded from cost totals, but token counts are retained. */
export function hasUnpricedUsage(usage: TokenUsage | null | undefined): boolean {
  return Object.entries(usage ?? {}).some(([model, u]) => {
    const r = rateFor(model);
    return !r || (u.cacheCreation > 0 && r.cacheWrite === null);
  });
}

export function emptyModelUsage(): ModelUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

/** Cost of one model's usage, in USD. */
export function modelCostUsd(model: string, u: ModelUsage): number {
  const r = rateFor(model);
  if (!r) return 0;
  return (
    (u.input * r.input +
      u.output * r.output +
      u.cacheRead * r.cacheRead +
      u.cacheCreation * (r.cacheWrite ?? 0)) /
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
