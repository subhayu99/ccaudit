import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";

async function freshPaths(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  vi.resetModules();
  const mod = await import("../src/paths.js");
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!;
  }
  return mod;
}

describe("paths: sessions dir + config", () => {
  it("defaults CLAUDE_SESSIONS_DIR to ~/.claude/sessions", async () => {
    const p = await freshPaths({ CCAUDIT_SESSIONS_DIR: undefined });
    expect(p.CLAUDE_SESSIONS_DIR).toBe(join(homedir(), ".claude", "sessions"));
  });
  it("honours CCAUDIT_SESSIONS_DIR override", async () => {
    const p = await freshPaths({ CCAUDIT_SESSIONS_DIR: "/tmp/fake-sessions" });
    expect(p.CLAUDE_SESSIONS_DIR).toBe("/tmp/fake-sessions");
  });
  it("CONFIG_PATH lives under the ccaudit home", async () => {
    const p = await freshPaths({ CCAUDIT_HOME: "/tmp/cc-home" });
    expect(p.CONFIG_PATH).toBe(join("/tmp/cc-home", "config.json"));
  });
});
