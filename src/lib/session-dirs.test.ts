import { describe, it, expect } from "vitest";
import {
  candidateDirsFromMessages,
  suggestSessionHome,
  inferSessionWorkdir,
  type DirKind,
} from "./session-dirs.js";

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

describe("inferSessionWorkdir", () => {
  // Two git repos under $HOME; proj-a is the launch/filed dir, proj-b is where work happens.
  const fs = (p: string): DirKind => {
    const dirs = new Set([
      "/Users/me/proj-a", "/Users/me/proj-b", "/Users/me/proj-b/src", "/Users/me/proj-b/tests",
    ]);
    const gits = new Set(["/Users/me/proj-a/.git", "/Users/me/proj-b/.git"]);
    if (gits.has(p) || dirs.has(p)) return "dir";
    if (p.endsWith(".ts") || p.endsWith(".json") || p.endsWith(".md")) return "file";
    return "missing";
  };
  // Six references, all into proj-b — clears the default min-hits floor of 5.
  const workInB = [
    raw('{"file_path":"/Users/me/proj-b/src/app.ts"}'),
    raw('{"file_path":"/Users/me/proj-b/src/db.ts"}'),
    raw('{"file_path":"/Users/me/proj-b/tests/app.test.ts"}'),
    raw("cd /Users/me/proj-b && npm test"),
    raw('{"file_path":"/Users/me/proj-b/package.json"}'),
    raw('{"file_path":"/Users/me/proj-b/README.md"}'),
  ];

  it("flags a misfiling: filed under proj-a, work lives in proj-b", () => {
    const r = inferSessionWorkdir(workInB, { resolve: fs, home, currentDir: "/Users/me/proj-a" });
    expect(r.mismatch).toBe(true);
    expect(r.inferredDir).toBe("/Users/me/proj-b");
    expect(r.launchRoot).toBe("/Users/me/proj-a");
    expect(r.launchHits).toBe(0);
    expect(r.inferredHits).toBeGreaterThanOrEqual(5);
  });

  it("reports no mismatch when the session is filed where the work happened", () => {
    const r = inferSessionWorkdir(workInB, { resolve: fs, home, currentDir: "/Users/me/proj-b" });
    expect(r.mismatch).toBe(false);
    expect(r.inferredDir).toBeNull();
    expect(r.launchHits).toBeGreaterThan(0);
  });

  it("does not flag on a couple of incidental cross-repo references (min-hits floor)", () => {
    const few = [raw('{"file_path":"/Users/me/proj-b/src/app.ts"}')];
    const r = inferSessionWorkdir(few, { resolve: fs, home, currentDir: "/Users/me/proj-a" });
    expect(r.mismatch).toBe(false);
    // ...but a caller can lower the floor to flag even a single dominant reference.
    expect(inferSessionWorkdir(few, { resolve: fs, home, currentDir: "/Users/me/proj-a", minHits: 1 }).mismatch).toBe(true);
  });

  it("flags a session whose launch dir no longer exists on disk", () => {
    const r = inferSessionWorkdir(workInB, { resolve: fs, home, currentDir: "/Users/me/proj-gone" });
    expect(r.inferredDir).toBe("/Users/me/proj-b");
    expect(r.mismatch).toBe(true);
  });

  it("returns no mismatch when the launch dir is unknown (cannot compare)", () => {
    const r = inferSessionWorkdir(workInB, { resolve: fs, home, currentDir: null });
    expect(r.mismatch).toBe(false);
    expect(r.launchRoot).toBeNull();
  });

  it("does not flag when the inferred dir only marginally out-references the filed dir (needs 2x)", () => {
    const msgs = [
      ...Array(10).fill('{"file_path":"/Users/me/proj-a/a.ts"}').map(raw),
      ...Array(12).fill('{"file_path":"/Users/me/proj-b/b.ts"}').map(raw),
    ];
    const r = inferSessionWorkdir(msgs, { resolve: fs, home, currentDir: "/Users/me/proj-a" });
    expect(r.launchHits).toBe(10);
    expect(r.mismatch).toBe(false); // proj-b 12 vs proj-a 10 is only 1.2× — below the 2× bar
  });

  it("does not flag when the dominant other dir is not a real project (no .git/package.json)", () => {
    const plainFs = (p: string): DirKind => {
      if (p === "/Users/me/proj-a/.git") return "dir";
      if (p === "/Users/me/proj-a" || p === "/Users/me/scratch") return "dir";
      if (p.endsWith(".ts")) return "file";
      return "missing"; // /Users/me/scratch holds no .git or package.json
    };
    const msgs = Array(8).fill('{"file_path":"/Users/me/scratch/x.ts"}').map(raw);
    const r = inferSessionWorkdir(msgs, { resolve: plainFs, home, currentDir: "/Users/me/proj-a" });
    expect(r.inferredDir).toBeNull();
    expect(r.mismatch).toBe(false); // scratch referenced 8× but it's not a resumable project
  });
});
