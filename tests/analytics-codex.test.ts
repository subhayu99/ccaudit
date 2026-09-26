import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { upsertSession } from "../src/db/sessions.js";
import { insertMessages } from "../src/db/messages.js";
import { getToolUsage, getSpend } from "../src/db/analytics.js";

describe("Codex tool analytics", () => {
  it("counts normalized tool-use rows by payload name", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccaudit-tools-"));
    const db = openDb(join(dir, "index.db"));
    try {
      upsertSession(db, {
        id: "codex:thread-1", provider: "codex", projectDir: "/p", projectLabel: "p",
        filePath: "/p/thread-1.jsonl", fileMtime: 1, fileSize: 1, startedAt: 1,
        lastActivity: 1, gitBranch: null, messageCount: 1, userMsgCount: 0,
        compactCount: 0, firstPrompt: null, aiTitle: null, cwd: "/p", indexedAt: 1,
      });
      insertMessages(db, [{
        sessionId: "codex:thread-1", lineNo: 1, uuid: null, parentUuid: null,
        type: "tool-use", role: "assistant", isSidechain: false, isCompactSummary: false,
        timestamp: 1, textContent: "functions.exec", rawJson: JSON.stringify({ payload: { name: "functions.exec" } }),
      }]);
      expect(getToolUsage(db)).toContainEqual({ tool: "functions.exec", count: 1 });
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("mixed model spend", () => {
  it("marks the total and unknown model incomplete while preserving known estimates", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccaudit-spend-"));
    const db = openDb(join(dir, "index.db"));
    try {
      upsertSession(db, {
        id: "codex:thread-2", provider: "codex", projectDir: "/p", projectLabel: "p",
        filePath: "/p/thread-2.jsonl", fileMtime: 1, fileSize: 1, startedAt: 1,
        lastActivity: 1, gitBranch: null, messageCount: 1, userMsgCount: 0,
        compactCount: 0, firstPrompt: null, aiTitle: null, cwd: "/p", indexedAt: 1,
        tokenUsage: {
          "gpt-6-sol": { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
          "unlisted-model": { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
        },
      });
      const spend = getSpend(db);
      expect(spend.totalCostUsd).toBe(2);
      expect(spend.hasUnpricedUsage).toBe(true);
      expect(spend.byModel.find((m) => m.model === "gpt-6-sol")?.hasUnpricedUsage).toBe(false);
      expect(spend.byModel.find((m) => m.model === "unlisted-model")?.hasUnpricedUsage).toBe(true);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
