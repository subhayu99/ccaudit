import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { indexAll } from "../src/indexer/index-runner.js";
import { getSession, listSessions } from "../src/db/sessions.js";
import { getSessionMessages, searchMessages } from "../src/db/messages.js";
import { toolGetSession, toolListSessions } from "../src/mcp/tools.js";
import { applyRehomeToDb } from "../src/lib/rehome-apply.js";

const line = (type: string, payload: unknown) => JSON.stringify({ timestamp: "2026-09-25T12:00:00Z", type, payload }) + "\n";
const message = (role: string, text: string) => line("response_item", { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });

describe("Codex joins the shared index", () => {
  let tmp: string, baseDir: string, codexDir: string, archive: string, file: string, db: ReturnType<typeof openDb>;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-codex-index-"));
    baseDir = join(tmp, "projects"); codexDir = join(tmp, "sessions"); archive = join(tmp, "archived_sessions");
    mkdirSync(join(baseDir, "-tmp-fixture"), { recursive: true });
    mkdirSync(join(codexDir, "2026/09/25"), { recursive: true });
    mkdirSync(archive);
    writeFileSync(join(baseDir, "-tmp-fixture/shared-id.jsonl"), JSON.stringify({ type: "user", cwd: tmp, message: { role: "user", content: "Claude history" } }) + "\n");
    file = join(codexDir, "2026/09/25/rollout.jsonl");
    writeFileSync(file, line("session_meta", { id: "shared-id", cwd: tmp, git: { branch: "main" } }) + message("user", "Find the codexneedle") + message("assistant", "Found it"));
    db = openDb(join(tmp, "index.db"));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });
  const run = (force = false) => indexAll(db, { baseDir, codexDirs: [codexDir, archive], force });

  it("indexes both providers and exposes Codex through search and MCP", async () => {
    const result = await run();
    expect(result.sessionsIndexed).toBe(2);
    expect(listSessions(db)).toHaveLength(2);
    expect(getSession(db, "shared-id")?.provider).toBe("claude");
    expect(getSession(db, "codex:shared-id")).toMatchObject({ provider: "codex", cwd: tmp, gitBranch: "main", firstPrompt: "Find the codexneedle" });
    expect(searchMessages(db, "codexneedle")[0]?.sessionId).toBe("codex:shared-id");
    expect(toolListSessions(db, {}).find(s => s.id === "codex:shared-id")).toHaveProperty("provider", "codex");
    expect(toolGetSession(db, { sessionId: "codex:shared-id", includeMessages: true })).toMatchObject({ provider: "codex", messages: expect.arrayContaining([expect.objectContaining({ text: "Found it" })]) });
  });
  it("skips unchanged files, refreshes appended turns, and retains identity when archived", async () => {
    await run();
    expect((await run()).sessionsIndexed).toBe(0);
    appendFileSync(file, message("user", "Another uniqueappend"));
    await run();
    expect(searchMessages(db, "uniqueappend")).toHaveLength(1);
    renameSync(file, join(archive, "rollout.jsonl"));
    await run();
    expect(listSessions(db)).toHaveLength(2);
    expect(getSession(db, "codex:shared-id")?.filePath).toBe(join(archive, "rollout.jsonl"));
    await run(true);
    expect(getSessionMessages(db, "codex:shared-id").filter(m => m.type === "user")).toHaveLength(2);
  });
  it("refuses Claude's source-file move operation for Codex", async () => {
    await run();
    const s = getSession(db, "codex:shared-id");
    expect(s).not.toBeNull();
    expect(() => applyRehomeToDb(db, s!, tmp)).toThrow(/Codex/);
  });
});
