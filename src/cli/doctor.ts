import { existsSync, statSync } from "node:fs";
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { CLAUDE_PROJECTS_DIR, INDEX_DB_PATH } from "../paths.js";

type Check = { name: string; ok: boolean; detail: string };

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

  let anyFail = false;
  for (const c of checks) {
    const status = c.ok ? kleur.green("OK") : kleur.red("ERR");
    console.log(`  [${status}] ${c.name} — ${c.detail}`);
    if (!c.ok) anyFail = true;
  }
  if (anyFail) process.exit(1);
}
