import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRemote } from "./remote.js";

/**
 * Runs a git subcommand in `cwd`. Returns trimmed stdout, or `null` if git
 * fails for any reason (not a repo, command error, git absent). Injected in
 * tests so the resolver stays pure and deterministic.
 */
export type GitRunner = (args: string[], cwd: string) => string | null;

/** Reads a manifest "name" field (package.json, etc.) at `cwd`, or null. */
export type ManifestReader = (cwd: string) => string | null;

export type IdentityKind = "git" | "manifest" | "path";

export type Identity = {
  kind: IdentityKind;
  /** Content-addressed history tokens (commit hashes); empty for non-git. */
  tokens: string[];
  /** Root commit if reachable (absent for shallow clones). */
  root?: string;
  /** Credential-stripped `host/org/repo`, if a remote was configured. */
  remote?: string;
  /** Manifest-declared name (an assertion, never a proof of identity). */
  manifestName?: string;
};

export type ResolveOptions = {
  existsOnDisk: boolean;
  git?: GitRunner;
  readManifest?: ManifestReader;
  /** How many commits to keep from each end of the history. Default 10. */
  tokensPerEnd?: number;
};

export const defaultGitRunner: GitRunner = (args, cwd) => {
  try {
    const out = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
};

export const defaultManifestReader: ManifestReader = (cwd) => {
  try {
    const raw = readFileSync(join(cwd, "package.json"), "utf8");
    const name = JSON.parse(raw)?.name;
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
};

/** unique first-N + last-N of a list, preserving order, no duplicates. */
function boundedEnds(items: string[], perEnd: number): string[] {
  if (items.length <= perEnd * 2) return [...new Set(items)];
  const head = items.slice(0, perEnd);
  const tail = items.slice(items.length - perEnd);
  return [...new Set([...head, ...tail])];
}

/**
 * Resolve the immutable identity tokens for a working directory.
 *
 * Identity can only be read while the directory still exists on disk; a
 * deleted worktree resolves to `kind:"path"` with no tokens (its lineage was
 * either captured earlier or is permanently unmatchable). See the design doc.
 */
export function resolveIdentity(cwd: string, opts: ResolveOptions): Identity {
  if (!opts.existsOnDisk) {
    return { kind: "path", tokens: [] };
  }

  const git = opts.git ?? defaultGitRunner;
  const perEnd = opts.tokensPerEnd ?? 10;

  const revList = git(["rev-list", "HEAD"], cwd);
  if (revList) {
    const commits = revList.split("\n").map((s) => s.trim()).filter(Boolean);
    const tokens = boundedEnds(commits, perEnd);
    const rootOut = git(["rev-list", "--max-parents=0", "HEAD"], cwd);
    const root = rootOut
      ? rootOut.split("\n").map((s) => s.trim()).filter(Boolean)[0]
      : undefined;
    if (root && !tokens.includes(root)) tokens.push(root);
    const remote = normalizeRemote(git(["config", "--get", "remote.origin.url"], cwd));
    const id: Identity = { kind: "git", tokens };
    if (root) id.root = root;
    if (remote) id.remote = remote;
    return id;
  }

  const readManifest = opts.readManifest ?? defaultManifestReader;
  const manifestName = readManifest(cwd);
  if (manifestName) {
    return { kind: "manifest", tokens: [], manifestName };
  }

  return { kind: "path", tokens: [] };
}
