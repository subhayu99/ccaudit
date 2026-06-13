import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { SERVE_STATE_PATH } from "../paths.js";

/** Runtime record of a live `ccaudit serve` so `ccaudit open` can reuse it instead of rebooting. */
export type ServeState = { port: number; pid: number; host: string; url: string; startedAt: number };

export function writeServeState(
  s: { port: number; pid: number; host: string; startedAt: number },
  path = SERVE_STATE_PATH
): void {
  try {
    const url = `http://${s.host}:${s.port}`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...s, url }, null, 2));
  } catch { /* best-effort */ }
}

export function readServeState(path = SERVE_STATE_PATH): ServeState | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw && typeof raw === "object" && typeof raw.port === "number" && typeof raw.url === "string") {
      return raw as ServeState;
    }
  } catch { /* missing / malformed */ }
  return null;
}

export function clearServeState(path = SERVE_STATE_PATH): void {
  try { rmSync(path, { force: true }); } catch { /* best-effort */ }
}

/** Liveness probe — does something actually answer at this URL? Any real HTTP response counts. */
export async function isServeUp(url: string, ms = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.status < 500;
  } catch {
    return false;
  }
}
