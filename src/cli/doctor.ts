import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { CLAUDE_PROJECTS_DIR, CODEX_DIRS, INDEX_DB_PATH } from "../paths.js";

// `optional: true` => a failure is a warning, not a hard error (e.g. the claude CLI,
// which only gates AI thread-naming / topic clustering).
type Check = { name: string; ok: boolean; detail: string; optional?: boolean };

export async function doctorCommand(): Promise<void> {
  const checks: Check[] = [];

  // Either provider can be the only installed agent. Missing optional roots are warnings.
  let availableRoots = 0;
  for (const [name, root] of [["projects dir", CLAUDE_PROJECTS_DIR], ...CODEX_DIRS.map(p => ["Codex sessions dir", p])] as Array<[string, string]>) {
    try {
      const ok = existsSync(root) && statSync(root).isDirectory();
      if (ok) availableRoots++;
      checks.push({ name, ok, optional: true, detail: ok ? `OK at ${root}` : `not found or not a directory: ${root}` });
    } catch (e) {
      checks.push({ name, ok: false, optional: true, detail: String(e) });
    }
  }
  if (!availableRoots) checks.push({ name: "session sources", ok: false, detail: "No Claude Code or Codex session directory found." });

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
