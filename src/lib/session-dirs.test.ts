import { describe, it, expect } from "vitest";
import { candidateDirsFromMessages, suggestSessionHome, type DirKind } from "./session-dirs.js";

const home = "/Users/me";
// Synthetic filesystem: which absolute paths are dirs vs files vs missing.
const DIRS = new Set([
  "/Users/me",
  "/Users/me/Downloads",
  "/Users/me/Downloads/newproj",
  "/Users/me/Downloads/newproj/src",
  "/usr/bin",
]);
const FILES = new Set([
  "/Users/me/Downloads/newproj/src/app.ts",
  "/Users/me/Downloads/newproj/src/util.ts",
  "/Users/me/Downloads/newproj/README.md",
  "/usr/bin/node",
]);
const resolve = (p: string): DirKind => (DIRS.has(p) ? "dir" : FILES.has(p) ? "file" : "missing");
const raw = (s: string) => ({ rawJson: s, textContent: null });

describe("candidateDirsFromMessages", () => {
  const msgs = [
    raw('{"tool":"Write","input":{"file_path":"/Users/me/Downloads/newproj/src/app.ts"}}'),
    raw('{"tool":"Edit","input":{"file_path":"/Users/me/Downloads/newproj/src/util.ts"}}'),
    raw('{"tool":"Write","input":{"file_path":"/Users/me/Downloads/newproj/README.md"}}'),
    raw("Let me run `cd /Users/me/Downloads/newproj && npm test` for you."),
    raw('{"tool":"Bash","input":{"command":"/usr/bin/node --version"}}'),
    raw('{"tool":"Read","input":{"file_path":"/Users/me/Downloads/newproj/deleted-file.ts"}}'), // missing file, dir exists
  ];

  it("ranks the real work dir first and excludes system dirs", () => {
    const c = candidateDirsFromMessages(msgs, { resolve, home, currentDir: "/Users/me/Downloads" });
    expect(c[0]!.dir).toBe("/Users/me/Downloads/newproj");
    expect(c.map((x) => x.dir)).not.toContain("/usr/bin"); // system dir filtered
    expect(c.find((x) => x.dir === "/Users/me/Downloads/newproj")!.underHome).toBe(true);
  });

  it("excludes the current (launch) dir from candidates", () => {
    const c = candidateDirsFromMessages(msgs, { resolve, home, currentDir: "/Users/me/Downloads" });
    expect(c.map((x) => x.dir)).not.toContain("/Users/me/Downloads");
  });

  it("recovers the dir of a referenced-but-deleted file (dir still exists)", () => {
    const c = candidateDirsFromMessages([msgs[5]!], { resolve, home });
    expect(c.map((x) => x.dir)).toContain("/Users/me/Downloads/newproj");
  });

  it("tallies hits — more-referenced dirs rank higher", () => {
    const c = candidateDirsFromMessages(msgs, { resolve, home });
    const np = c.find((x) => x.dir === "/Users/me/Downloads/newproj")!;
    const src = c.find((x) => x.dir === "/Users/me/Downloads/newproj/src");
    expect(np.hits).toBeGreaterThanOrEqual(src ? src.hits : 0);
  });

  it("returns nothing when no absolute paths are present", () => {
    expect(candidateDirsFromMessages([raw("just a chat with no paths")], { resolve, home })).toEqual([]);
  });

  it("excludes Claude-internal dirs (~/.claude/**) from candidates", () => {
    const m = [raw('{"file_path":"/Users/me/.claude/projects/x/memory/note.md"}')];
    const r = (p: string): DirKind =>
      p.startsWith("/Users/me/.claude") ? (p.endsWith(".md") ? "file" : "dir") : "missing";
    expect(candidateDirsFromMessages(m, { resolve: r, home })).toEqual([]);
  });
});

describe("suggestSessionHome", () => {
  // Two repos: launch repo proj-a, work happened in proj-b. `.git` marks roots.
  const fs = (p: string): DirKind => {
    const dirs = new Set([
      "/Users/me/proj-a", "/Users/me/proj-b", "/Users/me/proj-b/src", "/Users/me/proj-b/tests",
    ]);
    const gits = new Set(["/Users/me/proj-a/.git", "/Users/me/proj-b/.git"]);
    if (gits.has(p)) return "dir";
    if (dirs.has(p)) return "dir";
    if (p.endsWith(".ts")) return "file";
    return "missing";
  };
  const msgs = [
    raw('{"file_path":"/Users/me/proj-b/src/app.ts"}'),
    raw('{"file_path":"/Users/me/proj-b/src/db.ts"}'),
    raw('{"file_path":"/Users/me/proj-b/tests/app.test.ts"}'),
    raw("cd /Users/me/proj-b && npm test"),
  ];

  it("rolls work dirs up to the project root and excludes the launch repo", () => {
    const s = suggestSessionHome(msgs, { resolve: fs, home, currentDir: "/Users/me/proj-a" });
    expect(s[0]!.dir).toBe("/Users/me/proj-b"); // not /proj-b/src or /proj-b/tests
    expect(s.map((x) => x.dir)).not.toContain("/Users/me/proj-a");
  });
});
