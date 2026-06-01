import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_SESSIONS_DIR } from "../paths.js";

/** One running Claude Code instance, as recorded in ~/.claude/sessions/<pid>.json. */
export type LiveInstance = {
  pid: number;
  sessionId: string;
  cwd: string | null;
  name: string | null;
  status: string | null;
  waitingFor: string | null;
  version: string | null;
  startedAt: number | null;
  updatedAt: number | null;
};

export type ReadRegistryOpts = {
  /** Directory of <pid>.json files. Defaults to ~/.claude/sessions. */
  dir?: string;
  /** Liveness probe. Defaults to `process.kill(pid, 0)` (false on ESRCH). */
  isAlive?: (pid: number) => boolean;
  /**
   * Machine boot time (epoch ms). When > 0, entries whose `startedAt` predates it
   * are dropped — they are pre-reboot leftovers (the sessions dir survives reboots)
   * whose pid may now be reused by an unrelated process. Entries with an unknown
   * startedAt are kept. Pass `getBootTime()`.
   */
  bootTime?: number;
};

function defaultIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } // EPERM = exists but not ours
}

function str(v: unknown): string | null { return typeof v === "string" ? v : null; }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }

/**
 * Read the live-session registry, keeping only entries whose pid is currently alive.
 * Tolerates a missing dir and malformed/partial files (both are skipped).
 */
export function readLiveRegistry(opts: ReadRegistryOpts = {}): LiveInstance[] {
  const dir = opts.dir ?? CLAUDE_SESSIONS_DIR;
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const bootTime = opts.bootTime ?? 0;
  let names: string[];
  try { names = readdirSync(dir); }
  catch { return []; } // ENOENT etc. — no registry, nothing running we can see

  const out: LiveInstance[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(join(dir, name), "utf8")); }
    catch { continue; } // unreadable / malformed — skip
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const pid = num(o["pid"]);
    const sessionId = str(o["sessionId"]);
    // pid must be a real, positive id: process.kill(0|negative, 0) targets a
    // process group and would falsely report "alive", so reject those here.
    if (pid === null || pid <= 0 || !sessionId) continue;
    if (!isAlive(pid)) continue;
    const startedAt = num(o["startedAt"]);
    // Pre-reboot leftover whose pid may be reused: a live session always started after boot.
    if (bootTime > 0 && startedAt !== null && startedAt < bootTime) continue;
    out.push({
      pid, sessionId,
      cwd: str(o["cwd"]), name: str(o["name"]), status: str(o["status"]),
      waitingFor: str(o["waitingFor"]), version: str(o["version"]),
      startedAt, updatedAt: num(o["updatedAt"]),
    });
  }
  return out;
}
