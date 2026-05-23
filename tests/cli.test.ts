import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

describe("cli/reindex", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-cli-"));
    const proj = join(tmp, "projects", "-Users-x-proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "sess-x.jsonl"),
      `{"type":"user","sessionId":"sess-x","timestamp":"2026-05-23T10:00:00Z","message":{"role":"user","content":"hello"}}\n`
    );
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("creates ~/.ccaudit/index.db (overridden via env) and reports indexed count", () => {
    const result = spawnSync("npx", ["tsx", "src/cli/index.ts", "reindex"], {
      env: {
        ...process.env,
        CCAUDIT_HOME: tmp,
        CCAUDIT_PROJECTS_DIR: join(tmp, "projects"),
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/indexed 1 session/i);
    expect(existsSync(join(tmp, "index.db"))).toBe(true);
  });
});

describe("cli/list", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-cli-"));
    const proj = join(tmp, "projects", "-Users-x-proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "sess-x.jsonl"),
      `{"type":"user","sessionId":"sess-x","timestamp":"2026-05-23T10:00:00Z","message":{"role":"user","content":"hello"}}\n`
    );
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("prints a table of sessions after reindex", () => {
    const env = {
      ...process.env,
      CCAUDIT_HOME: tmp,
      CCAUDIT_PROJECTS_DIR: join(tmp, "projects"),
    };
    spawnSync("npx", ["tsx", "src/cli/index.ts", "reindex"], { env, encoding: "utf8" });
    const result = spawnSync("npx", ["tsx", "src/cli/index.ts", "list"], { env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sess-x");
    expect(result.stdout).toMatch(/x\/proj/);
  });
});

describe("cli/search", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-cli-"));
    const proj = join(tmp, "projects", "-Users-x-proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "sess-x.jsonl"),
      `{"type":"user","sessionId":"sess-x","timestamp":"2026-05-23T10:00:00Z","message":{"role":"user","content":"hello"}}\n`
    );
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("returns hits for a query after reindex", () => {
    const env = {
      ...process.env,
      CCAUDIT_HOME: tmp,
      CCAUDIT_PROJECTS_DIR: join(tmp, "projects"),
    };
    spawnSync("npx", ["tsx", "src/cli/index.ts", "reindex"], { env, encoding: "utf8" });
    const result = spawnSync("npx", ["tsx", "src/cli/index.ts", "search", "hello"], { env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sess-x");
    expect(result.stdout).toContain("hello");
  });

  it("prints a no-results message when nothing matches", () => {
    const env = {
      ...process.env,
      CCAUDIT_HOME: tmp,
      CCAUDIT_PROJECTS_DIR: join(tmp, "projects"),
    };
    spawnSync("npx", ["tsx", "src/cli/index.ts", "reindex"], { env, encoding: "utf8" });
    const result = spawnSync("npx", ["tsx", "src/cli/index.ts", "search", "zzzzzz"], { env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/no matches/i);
  });
});
