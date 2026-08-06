import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, statSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, checkpointWal, type Db } from "./init";

function walSize(dbPath: string): number {
  const w = `${dbPath}-wal`;
  return existsSync(w) ? statSync(w).size : 0;
}

describe("checkpointWal", () => {
  let db: Db | null = null;
  let dir: string | null = null;

  afterEach(() => {
    db?.close();
    db = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("truncates the WAL to zero and keeps the data readable", () => {
    dir = mkdtempSync(join(tmpdir(), "ccaudit-wal-"));
    const dbPath = join(dir, "index.db");
    db = openDb(dbPath);

    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, blob TEXT)");
    const ins = db.prepare("INSERT INTO t (blob) VALUES (?)");
    for (let i = 0; i < 5000; i++) ins.run("x".repeat(400));

    expect(walSize(dbPath)).toBeGreaterThan(0);

    checkpointWal(db);

    expect(walSize(dbPath)).toBe(0);
    const row = db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number };
    expect(row.n).toBe(5000);
  });
});
