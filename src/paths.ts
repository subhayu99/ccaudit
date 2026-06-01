import { homedir } from "node:os";
import { join } from "node:path";

const home = () => homedir();
const ccauditHome = () => process.env.CCAUDIT_HOME || join(home(), ".ccaudit");

export const CLAUDE_PROJECTS_DIR = process.env.CCAUDIT_PROJECTS_DIR || join(home(), ".claude", "projects");
export const CCAUDIT_DIR = ccauditHome();
export const INDEX_DB_PATH = join(ccauditHome(), "index.db");
export const EXPORTS_DIR = join(ccauditHome(), "exports");
export const LOGS_DIR = join(ccauditHome(), "logs");
export const CLAUDE_SESSIONS_DIR = process.env.CCAUDIT_SESSIONS_DIR || join(home(), ".claude", "sessions");
export const CONFIG_PATH = join(ccauditHome(), "config.json");

// Decode the dir-hash back to a real path. Claude Code stores
// ~/foo/bar as "-foo-bar" (slashes -> dashes, leading slash -> leading dash).
//
// WARNING: This decode is ambiguous for paths that contain literal dashes —
// e.g. "/Users/x/my-project" is encoded the same way as "/Users/x/my/project".
// The encoding has no inverse; this function returns a best-effort heuristic.
// Callers should treat the result as a display label, not a canonical path.
export function decodeProjectDir(encoded: string): string {
  // The "--" -> "//" quirk (and longer dash runs) yields empty path segments;
  // collapse any run of slashes back to a single "/" so the display label
  // never contains "//".
  return encoded.replace(/-/g, "/").replace(/\/{2,}/g, "/");
}

// Short label = last two path segments, e.g. "LoopProjects/backend"
export function projectLabel(realPath: string): string {
  const parts = realPath.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}
