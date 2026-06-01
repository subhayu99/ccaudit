import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("lib/config", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ccaudit-cfg-")); process.env.CCAUDIT_HOME = tmp; vi.resetModules(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); delete process.env.CCAUDIT_HOME; });

  it("returns {} when no config file exists", async () => {
    const { readConfig } = await import("../src/lib/config.js");
    expect(readConfig()).toEqual({});
  });

  it("writeConfig merges a patch and persists it", async () => {
    const { readConfig, writeConfig } = await import("../src/lib/config.js");
    writeConfig({ watch: "installed" });
    expect(readConfig()).toEqual({ watch: "installed" });
    writeConfig({ somethingElse: true } as Record<string, unknown>);
    expect(readConfig()).toMatchObject({ watch: "installed", somethingElse: true });
  });

  it("readConfig tolerates a malformed file (returns {})", async () => {
    writeFileSync(join(tmp, "config.json"), "{ broken");
    const { readConfig } = await import("../src/lib/config.js");
    expect(readConfig()).toEqual({});
  });
});
