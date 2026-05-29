/**
 * Normalize a git remote URL to a stable `host/org/repo` identity string.
 *
 * Security-critical: git remotes observed on disk can embed credentials
 * (e.g. `https://user:ghp_TOKEN@github.com/org/repo`). The returned value
 * MUST never contain credentials — only `host/org/repo`. The host is
 * lowercased (case-insensitive per DNS); the path case is preserved
 * (GitHub treats org/repo case-insensitively, but we don't assume that for
 * every forge, so we keep the authored case as-is).
 *
 * Returns `null` when the input is empty or cannot be parsed into a remote.
 */
export function normalizeRemote(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;

  let host: string;
  let path: string;

  // scp-style: [user@]host:org/repo(.git)  — no scheme, single colon, no "//"
  const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/;
  const scpMatch = !raw.includes("://") ? raw.match(scp) : null;
  if (scpMatch) {
    host = scpMatch[1]!;
    path = scpMatch[2]!;
  } else {
    // scheme-based: proto://[user[:token]@]host[:port]/path
    const m = raw.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/);
    if (!m) return null;
    // strip an optional :port from the authority
    host = m[1]!.replace(/:\d+$/, "");
    path = m[2]!;
  }

  // strip a trailing .git and any surrounding slashes from the path
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!host || !path) return null;

  return `${host.toLowerCase()}/${path}`;
}
