/**
 * Clamp a user-supplied `--limit` value into a sane range.
 *
 * Handles NaN, negative, zero, fractional, and huge inputs:
 * - non-finite / <= 0  -> `def`
 * - fractional         -> truncated toward zero
 * - > 1000             -> capped at 1000
 */
export function clampLimit(raw: unknown, def: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : def;
}
