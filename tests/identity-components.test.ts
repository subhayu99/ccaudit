import { describe, it, expect } from "vitest";
import { computeRepoComponents } from "../src/identity/components.js";
import type { WorkdirInput } from "../src/identity/components.js";

function wd(path: string, partial: Partial<WorkdirInput> = {}): WorkdirInput {
  return {
    path,
    tokens: [],
    remote: null,
    manifestName: null,
    kind: "path",
    ...partial,
  };
}

/** Set of member-path arrays, order-independent, for comparing groupings. */
function groupings(workdirs: WorkdirInput[]): Set<string> {
  const { repoByPath } = computeRepoComponents(workdirs);
  const byRepo = new Map<string, string[]>();
  for (const w of workdirs) {
    const id = repoByPath.get(w.path)!;
    byRepo.set(id, [...(byRepo.get(id) ?? []), w.path].sort());
  }
  return new Set([...byRepo.values()].map((g) => g.join("|")));
}

describe("computeRepoComponents", () => {
  it("merges two workdirs that share a commit hash", () => {
    const ws = [
      wd("/a", { tokens: ["root", "x"], kind: "git" }),
      wd("/b", { tokens: ["root", "y"], kind: "git" }),
    ];
    const { repos, repoByPath } = computeRepoComponents(ws);
    expect(repos).toHaveLength(1);
    expect(repoByPath.get("/a")).toBe(repoByPath.get("/b"));
    expect(repos[0]!.workdirPaths.sort()).toEqual(["/a", "/b"]);
  });

  it("keeps workdirs with no shared token in separate repos", () => {
    const ws = [
      wd("/a", { tokens: ["p"], kind: "git" }),
      wd("/b", { tokens: ["q"], kind: "git" }),
    ];
    expect(computeRepoComponents(ws).repos).toHaveLength(2);
  });

  it("merges transitively (A~B, B~C ⇒ A,B,C one repo)", () => {
    const ws = [
      wd("/a", { tokens: ["shared1", "a"], kind: "git" }),
      wd("/b", { tokens: ["shared1", "shared2"], kind: "git" }),
      wd("/c", { tokens: ["shared2", "c"], kind: "git" }),
    ];
    expect(groupings(ws)).toEqual(new Set(["/a|/b|/c"]));
  });

  it("merges two workdirs with the same remote even without shared commits", () => {
    const ws = [
      wd("/a", { tokens: ["onlyA"], remote: "github.com/org/repo", kind: "git" }),
      wd("/b", { tokens: ["onlyB"], remote: "github.com/org/repo", kind: "git" }),
    ];
    expect(computeRepoComponents(ws).repos).toHaveLength(1);
  });

  it("treats a plain non-git path as its own singleton repo (no aliasing)", () => {
    const ws = [
      wd("/proj", { tokens: ["c1"], kind: "git" }),
      wd("/scratch", { kind: "path" }),
    ];
    const { repos } = computeRepoComponents(ws);
    expect(repos).toHaveLength(2);
  });

  it("derives display name: remote repo basename, then manifest, then path basename", () => {
    const remoteRepo = computeRepoComponents([
      wd("/x", { tokens: ["c"], remote: "github.com/org/cool-repo", kind: "git" }),
    ]).repos[0]!;
    expect(remoteRepo.displayName).toBe("cool-repo");

    const manifestRepo = computeRepoComponents([
      wd("/y", { manifestName: "my-pkg", kind: "manifest" }),
    ]).repos[0]!;
    expect(manifestRepo.displayName).toBe("my-pkg");

    const pathRepo = computeRepoComponents([
      wd("/home/user/scratchpad", { kind: "path" }),
    ]).repos[0]!;
    expect(pathRepo.displayName).toBe("scratchpad");
  });

  it("produces identical groupings regardless of input order (deterministic)", () => {
    const ws = [
      wd("/a", { tokens: ["s", "a"], kind: "git" }),
      wd("/b", { tokens: ["s", "b"], kind: "git" }),
      wd("/c", { tokens: ["t"], kind: "git" }),
    ];
    const reversed = [...ws].reverse();
    const idsForward = computeRepoComponents(ws).repoByPath;
    const idsReverse = computeRepoComponents(reversed).repoByPath;
    expect(idsForward.get("/a")).toBe(idsReverse.get("/a"));
    expect(idsForward.get("/b")).toBe(idsReverse.get("/b"));
    expect(idsForward.get("/a")).toBe(idsForward.get("/b"));
    expect(idsForward.get("/c")).not.toBe(idsForward.get("/a"));
  });
});
