import { describe, it, expect } from "vitest";
import { resolveIdentity } from "../src/identity/resolve.js";
import type { GitRunner } from "../src/identity/resolve.js";

/**
 * Build a fake GitRunner from a map of "git subcommand keyword" → stdout.
 * Keyed on a distinguishing token in the args so tests stay readable.
 */
function fakeGit(responses: {
  revList?: string | null; // `rev-list HEAD`
  root?: string | null; // `rev-list --max-parents=0 HEAD`
  remote?: string | null; // `config --get remote.origin.url`
}): GitRunner {
  return (args: string[]) => {
    const joined = args.join(" ");
    if (joined.includes("--max-parents=0")) return responses.root ?? null;
    if (joined.includes("rev-list")) return responses.revList ?? null;
    if (joined.includes("remote.origin.url")) return responses.remote ?? null;
    return null;
  };
}

describe("resolveIdentity", () => {
  it("returns kind 'path' with no tokens when the directory is gone", () => {
    const id = resolveIdentity("/gone/dir", {
      existsOnDisk: false,
      git: fakeGit({ revList: "abc\ndef" }),
    });
    expect(id.kind).toBe("path");
    expect(id.tokens).toEqual([]);
  });

  it("captures a bounded first-N + last-N commit token-set including the root", () => {
    // newest-first, 10 commits c01 (HEAD) .. c10 (root)
    const commits = Array.from({ length: 10 }, (_, i) =>
      `c${String(i + 1).padStart(2, "0")}`
    );
    const id = resolveIdentity("/repo", {
      existsOnDisk: true,
      tokensPerEnd: 2,
      git: fakeGit({
        revList: commits.join("\n"),
        root: "c10",
        remote: "https://github.com/org/repo.git",
      }),
    });
    expect(id.kind).toBe("git");
    // first 2 (recent) + last 2 (ancient, incl root), deduped
    expect(new Set(id.tokens)).toEqual(new Set(["c01", "c02", "c09", "c10"]));
    expect(id.root).toBe("c10");
    expect(id.remote).toBe("github.com/org/repo");
  });

  it("credential-strips the remote it reports", () => {
    const id = resolveIdentity("/repo", {
      existsOnDisk: true,
      git: fakeGit({
        revList: "a1\na2",
        root: "a2",
        remote: "https://u:ghp_TOKEN@github.com/org/repo.git",
      }),
    });
    expect(id.remote).toBe("github.com/org/repo");
    expect(JSON.stringify(id)).not.toContain("ghp_TOKEN");
  });

  it("keeps all commits without duplicates when fewer than 2*tokensPerEnd exist", () => {
    const id = resolveIdentity("/repo", {
      existsOnDisk: true,
      tokensPerEnd: 5,
      git: fakeGit({ revList: "x1\nx2\nx3", root: "x3" }),
    });
    expect(id.tokens).toEqual(["x1", "x2", "x3"]);
  });

  it("handles a shallow clone with no reachable root commit", () => {
    const id = resolveIdentity("/shallow", {
      existsOnDisk: true,
      git: fakeGit({ revList: "tip1\ntip2", root: null }),
    });
    expect(id.kind).toBe("git");
    expect(id.tokens).toEqual(["tip1", "tip2"]);
    expect(id.root).toBeUndefined();
  });

  it("falls back to a manifest name when the dir exists but is not a git repo", () => {
    const id = resolveIdentity("/plain", {
      existsOnDisk: true,
      git: fakeGit({ revList: null }),
      readManifest: () => "my-package",
    });
    expect(id.kind).toBe("manifest");
    expect(id.manifestName).toBe("my-package");
    expect(id.tokens).toEqual([]);
  });

  it("falls back to kind 'path' when there is neither git nor a manifest", () => {
    const id = resolveIdentity("/bare", {
      existsOnDisk: true,
      git: fakeGit({ revList: null }),
      readManifest: () => null,
    });
    expect(id.kind).toBe("path");
    expect(id.tokens).toEqual([]);
  });
});
