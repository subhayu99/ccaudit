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

type DirOpts = {
  resolve?: (p: string) => DirKind;
  home?: string;
  limit?: number;
  currentDir?: string | null;
};

/**
 * Candidate dirs rolled up to their project root (nearest enclosing `.git`/`package.json`),
 * hits summed per root and sorted (under-$HOME first, then frequency). Also returns the launch
 * dir's own project root so callers can include or exclude it. The shared core of
 * `suggestSessionHome` (excludes the launch root) and `inferSessionWorkdir` (compares against it).
 */
function rollupToRoots(
  messages: Pick<MessageRow, "rawJson" | "textContent">[],
  opts: DirOpts
): { roots: HomeSuggestion[]; launchRoot: string | null } {
  const resolve = opts.resolve ?? realResolve;
  const home = opts.home ?? homedir();
  const current = opts.currentDir ?? null;

  const candidates = candidateDirsFromMessages(messages, { resolve, home, currentDir: null, limit: 200 });
  const launchRoot = current ? projectRootOf(current, resolve, home) : null;

  const tally = new Map<string, number>();
  for (const c of candidates) {
    const root = projectRootOf(c.dir, resolve, home);
    tally.set(root, (tally.get(root) ?? 0) + c.hits);
  }

  const roots = [...tally.entries()]
    .map(([dir, h]) => ({ dir, hits: h, underHome: dir === home || dir.startsWith(home + "/") }))
    .sort((a, b) => Number(b.underHome) - Number(a.underHome) || b.hits - a.hits);
  return { roots, launchRoot };
}

/**
 * Best "home" directories for a session: candidate dirs rolled up to their project
 * root, hits summed per root, the launch dir's own root excluded. The top result is
 * where the work actually lives — the target a misfiled session should be moved to.
 */
export function suggestSessionHome(
  messages: Pick<MessageRow, "rawJson" | "textContent">[],
  opts: DirOpts = {}
): HomeSuggestion[] {
  const limit = opts.limit ?? 6;
  const { roots, launchRoot } = rollupToRoots(messages, opts);
  return roots.filter((r) => r.dir !== launchRoot).slice(0, limit);
}

/** Hit floor below which a dominant other-root is treated as incidental noise, not a misfiling. */
export const MISMATCH_MIN_HITS = 5;

/** The inferred dir must out-reference the filed dir by at least this factor to count as misfiled
 *  (so a 14-vs-12 tie doesn't flag — only a dir the session clearly worked in instead). */
export const MISMATCH_DOMINANCE = 2;

function hasProjectMarker(dir: string, resolve: (p: string) => DirKind): boolean {
  return resolve(dir + "/.git") !== "missing" || resolve(dir + "/package.json") === "file";
}

/**
 * True if both paths map to the SAME Claude project folder. Claude encodes a launch dir by
 * replacing every `/` and `.` with `-`, so `~/x/repo.io` and `~/x/repo/io` (and `foo-bar` vs
 * `foo/bar`) collapse to one folder. When a session's `cwd` is absent we fall back to the decoded
 * folder name, which can pick the wrong separators — making a correctly-filed session look misfiled
 * to its own directory. Treating same-folder pairs as not-a-move kills that whole false-positive class.
 */
export function sameProjectFolder(a: string, b: string): boolean {
  return a.replace(/[/.]/g, "-") === b.replace(/[/.]/g, "-");
}

/** True if `dir` is a resumable project root (holds `.git` or `package.json`) — i.e. a place
 *  `claude --resume` is actually useful, not a generic container like ~/Downloads or ~/Documents. */
export function isProjectRoot(dir: string, opts: { resolve?: (p: string) => DirKind } = {}): boolean {
  return hasProjectMarker(dir, opts.resolve ?? realResolve);
}

export type WorkdirInference = {
  /** Project root of the launch/filed dir (where the session currently lives). */
  launchRoot: string | null;
  /** Path-reference hits rolling up to `launchRoot`. */
  launchHits: number;
  /** The dominant other project root, set ONLY when it's a genuine misfiling; else null. */
  inferredDir: string | null;
  /** Hits backing `inferredDir` (0 when not a mismatch). */
  inferredHits: number;
  /** True when a non-launch root dominates the launch root by more than the noise floor. */
  mismatch: boolean;
};

/**
 * Decide whether a session is misfiled: was it filed under `currentDir` but does the
 * bulk of its referenced work actually live in a different project root? Reuses the
 * candidate→root rollup, then compares the best non-launch root against the launch
 * root. A mismatch needs the other root to (a) out-reference the launch root and
 * (b) clear `minHits`, so a couple of incidental cross-repo paths don't trigger it.
 * Computed once at index time and stored on the session row — never scanned on demand.
 */
export function inferSessionWorkdir(
  messages: Pick<MessageRow, "rawJson" | "textContent">[],
  opts: DirOpts & { minHits?: number } = {}
): WorkdirInference {
  const minHits = opts.minHits ?? MISMATCH_MIN_HITS;
  const resolve = opts.resolve ?? realResolve;
  const { roots, launchRoot } = rollupToRoots(messages, opts);
  const launchHits = roots.find((r) => r.dir === launchRoot)?.hits ?? 0;
  const best = roots.find((r) => r.dir !== launchRoot) ?? null; // roots is sorted → first non-launch wins
  const bestHits = best?.hits ?? 0;
  // A genuine misfiling: a DIFFERENT resumable project that the session references clearly more
  // than where it's filed — past the noise floor, dominating by ≥2×, and an actual project root
  // (not a generic container dir). Anything weaker is incidental cross-repo chatter, not a move.
  const mismatch =
    launchRoot !== null &&
    best !== null &&
    bestHits >= minHits &&
    bestHits >= launchHits * MISMATCH_DOMINANCE &&
    hasProjectMarker(best.dir, resolve) &&
    !(opts.currentDir != null && sameProjectFolder(best.dir, opts.currentDir));
  return {
    launchRoot,
    launchHits,
    inferredDir: mismatch ? best!.dir : null,
    inferredHits: mismatch ? bestHits : 0,
    mismatch,
  };
}
