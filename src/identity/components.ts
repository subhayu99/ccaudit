import type { IdentityKind } from "./resolve.js";

/** A working directory annotated with its captured identity tokens. */
export type WorkdirInput = {
  path: string;
  tokens: string[];
  remote: string | null;
  manifestName: string | null;
  kind: IdentityKind;
};

/** A logical repository — a connected component of workdirs. */
export type Repo = {
  /** Stable, order-independent id for the component. */
  repoId: string;
  displayName: string;
  /** Sorted member workdir paths. */
  workdirPaths: string[];
  /** Representative credential-stripped remote, if any. */
  remote: string | null;
};

export type RepoComponents = {
  repos: Repo[];
  repoByPath: Map<string, string>;
};

/** Last non-empty path segment. */
function basename(p: string): string {
  const segs = p.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1]! : p;
}

/**
 * Group workdirs into logical repos via union-find over shared immutable
 * tokens. Two workdirs are the same repo iff they share a commit hash, or
 * (secondary) share a normalized remote. Plain paths with no tokens and no
 * remote stay as their own singleton — there is no aliasing to resolve.
 *
 * Deterministic: output grouping and repoIds are independent of input order.
 */
export function computeRepoComponents(workdirs: WorkdirInput[]): RepoComponents {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // path compression
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // attach larger-id root under smaller for determinism
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  for (const w of workdirs) parent.set(w.path, w.path);

  // edges: first workdir seen carrying a token "claims" it; later carriers union to it.
  const firstByToken = new Map<string, string>();
  const claim = (token: string, path: string) => {
    const owner = firstByToken.get(token);
    if (owner === undefined) firstByToken.set(token, path);
    else union(owner, path);
  };
  for (const w of workdirs) {
    for (const t of w.tokens) claim(`commit:${t}`, w.path);
    if (w.remote) claim(`remote:${w.remote}`, w.path);
  }

  // collect members per component root
  const members = new Map<string, WorkdirInput[]>();
  for (const w of workdirs) {
    const root = find(w.path);
    members.set(root, [...(members.get(root) ?? []), w]);
  }

  const repos: Repo[] = [];
  const repoByPath = new Map<string, string>();
  for (const group of members.values()) {
    const paths = group.map((w) => w.path).sort();
    const remotes = [...new Set(group.map((w) => w.remote).filter((r): r is string => !!r))].sort();
    const remote = remotes[0] ?? null;
    const repoId = remote ? `remote:${remote}` : `path:${paths[0]}`;

    let displayName: string;
    if (remote) displayName = basename(remote);
    else {
      const manifest = group.map((w) => w.manifestName).find((m): m is string => !!m);
      displayName = manifest ?? basename(paths[0]!);
    }

    repos.push({ repoId, displayName, workdirPaths: paths, remote });
    for (const p of paths) repoByPath.set(p, repoId);
  }

  repos.sort((a, b) => a.repoId.localeCompare(b.repoId));
  return { repos, repoByPath };
}
