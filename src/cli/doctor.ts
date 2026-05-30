import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { CLAUDE_PROJECTS_DIR, INDEX_DB_PATH } from "../paths.js";

// `optional: true` => a failure is a warning, not a hard error (e.g. the claude CLI,
// which only gates AI thread-naming / topic clustering).
type Check = { name: string; ok: boolean; detail: string; optional?: boolean };

export async function doctorCommand(): Promise<void> {
  const checks: Check[] = [];

  // Projects dir
  try {
    if (!existsSync(CLAUDE_PROJECTS_DIR)) {
      checks.push({
        name: "projects dir",
        ok: false,
        detail: `not found: ${CLAUDE_PROJECTS_DIR}`,
      });
    } else {
      const st = statSync(CLAUDE_PROJECTS_DIR);
      checks.push({
        name: "projects dir",
        ok: st.isDirectory(),
        detail: st.isDirectory() ? `OK at ${CLAUDE_PROJECTS_DIR}` : "path exists but is not a directory",
      });
    }
  } catch (e) {
    checks.push({
      name: "projects dir",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // Index db
  try {
    const db = openDb(INDEX_DB_PATH);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    checks.push({ name: "index db", ok: true, detail: `OK at ${INDEX_DB_PATH} (${count} sessions)` });
    db.close();
  } catch (e) {
    checks.push({
      name: "index db",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // claude CLI — optional; gates AI thread-naming + topic clustering only.
  try {
    const out = execFileSync("claude", ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
    checks.push({ name: "claude CLI", ok: true, detail: `found (${out})`, optional: true });
  } catch (e) {
    const enoent = (e as { code?: string }).code === "ENOENT";
    checks.push({
      name: "claude CLI",
      ok: false,
      optional: true,
      detail: enoent
        ? "not on PATH — AI naming/clustering disabled (install Claude Code to enable)"
        : `probe failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  let anyFail = false;
  for (const c of checks) {
    const status = c.ok ? kleur.green("OK") : c.optional ? kleur.yellow("WARN") : kleur.red("ERR");
    console.log(`  [${status}] ${c.name} — ${c.detail}`);
    if (!c.ok && !c.optional) anyFail = true;
  }
  if (anyFail) process.exit(1);
}
