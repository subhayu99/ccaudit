import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_PATH } from "../paths.js";

export type CcauditConfig = {
  /** Whether the user installed (or declined) the background session watcher. */
  watch?: "installed" | "declined";
  /** One-time consent to re-home sessions (which writes/moves files in ~/.claude). */
  rehomeConsent?: "accepted";
  [k: string]: unknown;
};

/** Best-effort read of ~/.ccaudit/config.json. Missing/malformed → {}. */
export function readConfig(): CcauditConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return raw && typeof raw === "object" ? (raw as CcauditConfig) : {};
  } catch { return {}; }
}

/** Merge `patch` into the config and persist. Best-effort (never throws). */
export function writeConfig(patch: Partial<CcauditConfig>): void {
  try {
    const next = { ...readConfig(), ...patch };
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  } catch { /* best-effort */ }
}
