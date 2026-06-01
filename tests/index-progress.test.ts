import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db/init.js";
import { indexAll, type IndexProgress } from "../src/indexer/index-runner.js";

const userLine = (text: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";

describe("indexAll progress reporting", () => {
  let tmp: string, baseDir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ccaudit-prog-"));
    baseDir = join(tmp, "projects");
    mkdirSync(join(baseDir, "-Users-x-a"), { recursive: true });
    mkdirSync(join(baseDir, "-Users-x-b"), { recursive: true });
    writeFileSync(join(baseDir, "-Users-x-a", "s1.jsonl"), userLine("alpha"));
    writeFileSync(join(baseDir, "-Users-x-a", "s2.jsonl"), userLine("bravo"));
    writeFileSync(join(baseDir, "-Users-x-b", "s3.jsonl"), userLine("charlie"));
    db = openDb(join(tmp, "i.db"));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it("emits a scan event with the total, then index events counting up to it", async () => {
    const events: IndexProgress[] = [];
    await indexAll(db, { baseDir, onProgress: (p) => events.push(p) });

    expect(events.find((e) => e.phase === "scan")).toEqual({ phase: "scan", total: 3 });

    const index = events.filter(
      (e): e is Extract<IndexProgress, { phase: "index" }> => e.phase === "index"
    );
    expect(index.length).toBe(3); // one per session file (fires even for skips)
    expect(index.map((e) => e.current)).toEqual([1, 2, 3]); // monotonic counter
    expect(index.every((e) => e.total === 3)).toBe(true);
  });

  it("emits a resolve event, ordered scan → index → resolve", async () => {
    const events: IndexProgress[] = [];
    await indexAll(db, { baseDir, onProgress: (p) => events.push(p) });
    const phases = events.map((e) => e.phase);
    expect(phases).toContain("resolve");
    expect(phases.indexOf("scan")).toBeLessThan(phases.indexOf("index"));
    expect(phases.lastIndexOf("index")).toBeLessThan(phases.indexOf("resolve"));
  });
});
