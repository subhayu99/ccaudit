import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeProjectDir, rewriteSessionCwd, rehomeSession } from "./rehome.js";

describe("encodeProjectDir", () => {
  it("turns / and . into - (Claude's scheme)", () => {
    expect(encodeProjectDir("/Users/me/Downloads/ledger")).toBe("-Users-me-Downloads-ledger");
    expect(encodeProjectDir("/Users/me/.claude-mem/x")).toBe("-Users-me--claude-mem-x");
  });
});

describe("rewriteSessionCwd", () => {
  const A = "/Users/me/parent";
  const B = "/Users/me/parent/proj";
  it("rewrites only matching cwd fields, preserves everything else", () => {
    const jsonl = [
      JSON.stringify({ type: "user", cwd: A, text: "hi" }),
      JSON.stringify({ type: "assistant", cwd: A, text: `see ${B}/app.ts` }),
      "not-json-line",
      JSON.stringify({ type: "summary", cwd: null }),
      JSON.stringify({ type: "x", cwd: "/some/other/dir" }),
    ].join("\n");
    const { content, rewritten } = rewriteSessionCwd(jsonl, A, B);
    expect(rewritten).toBe(2);
    expect(content).toContain(`"cwd":"${B}"`);
    expect(content).toContain("not-json-line"); // non-JSON preserved
    expect(content).toContain('"cwd":null'); // null cwd preserved
    expect(content).toContain('"cwd":"/some/other/dir"'); // unrelated cwd untouched
    expect(content).toContain(`see ${B}/app.ts`); // content paths untouched
  });
});

describe("rehomeSession", () => {
  const A = "/Users/me/parent";
  const B = "/Users/me/parent/proj";
  const id = "test-session-1";
  let sandbox: string, projectsRoot: string, backupDir: string, sourceFile: string;
  const original =
    [
      JSON.stringify({ type: "user", cwd: A, text: "hi" }),
      JSON.stringify({ type: "assistant", cwd: A, text: "ok" }),
      JSON.stringify({ type: "summary", cwd: A }),
    ].join("\n") + "\n";

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "ccaudit-rehome-"));
    projectsRoot = join(sandbox, "projects");
    backupDir = join(sandbox, "backups");
    const srcFolder = join(projectsRoot, encodeProjectDir(A));
    mkdirSync(srcFolder, { recursive: true });
    sourceFile = join(srcFolder, `${id}.jsonl`);
    writeFileSync(sourceFile, original);
  });
  afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

  it("moves the file, rewrites cwd, backs up the original, removes the source", () => {
    const res = rehomeSession({ sessionId: id, sourceFile, oldCwd: A, targetDir: B, projectsRoot, backupDir, stamp: "STAMP" });

    // destination
    expect(existsSync(res.targetFile)).toBe(true);
    expect(res.targetFile).toBe(join(projectsRoot, encodeProjectDir(B), `${id}.jsonl`));
    expect(readFileSync(res.targetFile, "utf8")).toContain(`"cwd":"${B}"`);
    expect(res.linesRewritten).toBe(3);
    expect(res.lineCount).toBe(3);

    // backup holds the ORIGINAL (cwd=A), byte-identical
    expect(existsSync(res.backupFile)).toBe(true);
    expect(readFileSync(res.backupFile, "utf8")).toBe(original);

    // source gone
    expect(existsSync(sourceFile)).toBe(false);
  });

  it("refuses to clobber an existing destination, leaving the source intact", () => {
    const destFolder = join(projectsRoot, encodeProjectDir(B));
    mkdirSync(destFolder, { recursive: true });
    writeFileSync(join(destFolder, `${id}.jsonl`), "EXISTING");
    expect(() => rehomeSession({ sessionId: id, sourceFile, oldCwd: A, targetDir: B, projectsRoot, backupDir, stamp: "S" })).toThrow(/not overwriting/);
    expect(existsSync(sourceFile)).toBe(true); // untouched
    expect(readFileSync(join(destFolder, `${id}.jsonl`), "utf8")).toBe("EXISTING"); // untouched
  });

  it("refuses a no-op move to the same directory", () => {
    expect(() => rehomeSession({ sessionId: id, sourceFile, oldCwd: A, targetDir: A, projectsRoot, backupDir, stamp: "S" })).toThrow(/already lives/);
    expect(existsSync(sourceFile)).toBe(true);
  });
});
