import { statSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import type { MessageRow } from "../types.js";

export type DirKind = "dir" | "file" | "missing";
export type DirCandidate = { dir: string; hits: number; underHome: boolean };

// Absolute POSIX paths: a leading "/" then one or more path segments. Segment chars
// cover the common set in code paths (no spaces — rare in real file paths and risky to match).
const ABS_PATH = /\/(?:[A-Za-z0-9._+\-@]+\/)*[A-Za-z0-9._+\-@]+/g;

// Directories we never propose as a session's home — system + ephemeral locations.
const SYSTEM_PREFIXES = [
  "/usr", "/bin", "/sbin", "/etc", "/var", "/private", "/System",
  "/Library", "/opt", "/tmp", "/dev", "/proc", "/nix", "/snap",
];

function realResolve(p: string): DirKind {
  try {
    return statSync(p).isDirectory() ? "dir" : "file";
  } catch {
    return "missing";
  }
}

/** Tool/agent-internal locations under $HOME that are never a user's project home. */
function internalPrefixes(home: string): string[] {
  return [home + "/.claude", home + "/.ccaudit", home + "/.claude-mem", home + "/.config/superpowers", home + "/Library"];
}

function excludedDir(dir: string, home: string): boolean {
  if (SYSTEM_PREFIXES.some((s) => dir === s || dir.startsWith(s + "/"))) return true;
  return internalPrefixes(home).some((p) => dir === p || dir.startsWith(p + "/"));
}

/** Walk up to the nearest project root — a dir holding `.git` or `package.json` — else the dir itself. */
function projectRootOf(dir: string, resolve: (p: string) => DirKind, home: string): string {
  let cur = dir;
  let pkgRoot: string | null = null; // nearest package.json, used only if no .git is found
  for (let i = 0; i < 40; i++) {
    if (resolve(cur + "/.git") !== "missing") return cur; // git root wins (handles monorepos)
    if (pkgRoot === null && resolve(cur + "/package.json") === "file") pkgRoot = cur;
    const parent = dirname(cur);
    if (parent === cur || cur === home || !cur.startsWith(home + "/")) break;
    cur = parent;
  }
  return pkgRoot ?? dir;
}

/**
 * Candidate working directories referenced in a session, ranked.
 *
 * Claude emits absolute paths (tool `file_path`s, `cd` targets, Bash commands), so we
 * parse every absolute path out of each message's raw JSON, reduce it to a directory
 * (the path itself if it's a dir, else its parent), keep only directories that EXIST on
 * disk right now, drop system/ephemeral locations, and rank by under-$HOME first, then
 * reference frequency, then specificity (depth). `resolve` is injectable for testing.
 */
export function candidateDirsFromMessages(
  messages: Pick<MessageRow, "rawJson" | "textContent">[],
  opts: {
    resolve?: (p: string) => DirKind;
    home?: string;
    limit?: number;
    currentDir?: string | null;
  } = {}
): DirCandidate[] {
  const resolve = opts.resolve ?? realResolve;
  const home = opts.home ?? homedir();
  const limit = opts.limit ?? 8;
  const current = opts.currentDir ?? null;

  const cache = new Map<string, DirKind>();
  const kind = (p: string): DirKind => {
    let k = cache.get(p);
    if (k === undefined) { k = resolve(p); cache.set(p, k); }
    return k;
  };

  const hits = new Map<string, number>();
  for (const m of messages) {
    const text = m.rawJson || m.textContent || "";
    const matches = text.match(ABS_PATH);
    if (!matches) continue;
    for (const m0 of matches) {
      if (m0.includes("/..")) continue; // skip un-normalized relative segments
      const p = m0.replace(/\/+$/, "") || "/";
      const dir = kind(p) === "dir" ? p : dirname(p);
      if (dir === "/" || dir === "." || excludedDir(dir, home)) continue;
      if (kind(dir) !== "dir") continue; // only directories that actually exist
      hits.set(dir, (hits.get(dir) ?? 0) + 1);
    }
  }

  return [...hits.entries()]
    .map(([dir, h]) => ({ dir, hits: h, underHome: dir === home || dir.startsWith(home + "/") }))
    .filter((c) => c.dir !== current)
    .sort(
      (a, b) =>
        Number(b.underHome) - Number(a.underHome) ||
        b.hits - a.hits ||
        b.dir.length - a.dir.length
    )
    .slice(0, limit);
}

export type HomeSuggestion = { dir: string; hits: number; underHome: boolean };

/**
 * Best "home" directories for a session: candidate dirs rolled up to their project
 * root (nearest enclosing `.git`/`package.json`), hits summed per root, the launch
 * dir's own root excluded. The top result is where the work actually lives — the
 * target a misfiled session should be moved to.
 */
export function suggestSessionHome(
  messages: Pick<MessageRow, "rawJson" | "textContent">[],
  opts: {
    resolve?: (p: string) => DirKind;
    home?: string;
    limit?: number;
    currentDir?: string | null;
  } = {}
): HomeSuggestion[] {
  const resolve = opts.resolve ?? realResolve;
  const home = opts.home ?? homedir();
  const limit = opts.limit ?? 6;
  const current = opts.currentDir ?? null;

  const candidates = candidateDirsFromMessages(messages, { ...opts, currentDir: null, limit: 200 });
  const launchRoot = current ? projectRootOf(current, resolve, home) : null;

  const roots = new Map<string, number>();
  for (const c of candidates) {
    const root = projectRootOf(c.dir, resolve, home);
    if (root === launchRoot) continue; // already home'd here
    roots.set(root, (roots.get(root) ?? 0) + c.hits);
  }

  return [...roots.entries()]
    .map(([dir, h]) => ({ dir, hits: h, underHome: dir === home || dir.startsWith(home + "/") }))
    .sort((a, b) => Number(b.underHome) - Number(a.underHome) || b.hits - a.hits)
    .slice(0, limit);
}
