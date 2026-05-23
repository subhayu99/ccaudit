import { homedir } from "node:os";
import { join } from "node:path";

export const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
export const CCAUDIT_DIR = join(homedir(), ".ccaudit");
export const INDEX_DB_PATH = join(CCAUDIT_DIR, "index.db");
export const EXPORTS_DIR = join(CCAUDIT_DIR, "exports");
export const LOGS_DIR = join(CCAUDIT_DIR, "logs");

// Decode the dir-hash back to a real path. Claude Code stores
// ~/foo/bar as "-foo-bar" (slashes -> dashes, leading slash -> leading dash).
export function decodeProjectDir(encoded: string): string {
  return encoded.replace(/-/g, "/");
}

// Short label = last two path segments, e.g. "LoopProjects/backend"
export function projectLabel(realPath: string): string {
  const parts = realPath.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}
