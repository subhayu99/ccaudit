import { describe, it, expect } from "vitest";
import { normalizeRemote } from "../src/identity/remote.js";

describe("normalizeRemote", () => {
  it("strips the .git suffix and scheme from an https URL", () => {
    expect(normalizeRemote("https://github.com/subhayu99/ccaudit.git")).toBe(
      "github.com/subhayu99/ccaudit"
    );
  });

  it("removes embedded user:token credentials (security-critical)", () => {
    const out = normalizeRemote(
      "https://subhayu99:ghp_SECRETTOKEN1234@github.com/org/repo.git"
    );
    expect(out).toBe("github.com/org/repo");
    expect(out).not.toContain("ghp_SECRETTOKEN1234");
    expect(out).not.toContain("subhayu99");
    expect(out).not.toContain("@");
  });

  it("normalizes scp-style git@host:org/repo.git", () => {
    expect(normalizeRemote("git@github.com:org/repo.git")).toBe(
      "github.com/org/repo"
    );
  });

  it("handles ssh:// URLs with a port and nested groups", () => {
    expect(
      normalizeRemote("ssh://git@gitlab.com:22/group/sub/repo.git")
    ).toBe("gitlab.com/group/sub/repo");
  });

  it("lowercases the host but preserves path case", () => {
    expect(normalizeRemote("https://GitHub.com/Org/Repo")).toBe(
      "github.com/Org/Repo"
    );
  });

  it("returns null for empty or unusable input", () => {
    expect(normalizeRemote("")).toBeNull();
    expect(normalizeRemote(undefined)).toBeNull();
    expect(normalizeRemote("   ")).toBeNull();
  });
});
