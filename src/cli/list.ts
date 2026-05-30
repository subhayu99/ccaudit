import kleur from "kleur";
import { openDb } from "../db/init.js";
import { listSessions } from "../db/sessions.js";
import { INDEX_DB_PATH } from "../paths.js";
import { clampLimit } from "./limit.js";

export async function listCommand(opts: { project?: string; limit?: string }): Promise<void> {
  const db = openDb(INDEX_DB_PATH);
  try {
    const rows = listSessions(db, {
      projectDir: opts.project,
      limit: clampLimit(opts.limit, 30),
    });
    if (rows.length === 0) {
      console.log("(no sessions indexed — run `ccaudit reindex`)");
      return;
    }
    const headers = ["LAST ACTIVITY", "PROJECT", "MSGS", "COMPACTS", "SESSION", "FIRST PROMPT"];
    const dataRows = rows.map((r) => [
      r.lastActivity ? new Date(r.lastActivity).toISOString().slice(0, 19).replace("T", " ") : "—",
      r.projectLabel,
      String(r.messageCount),
      String(r.compactCount),
      r.id.slice(0, 8),
      (r.firstPrompt ?? "").replace(/\s+/g, " ").slice(0, 60),
    ]);
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...dataRows.map((row) => row[i]!.length))
    );
    const fmt = (cells: string[]) =>
      cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
    console.log(kleur.bold(fmt(headers)));
    for (const row of dataRows) console.log(fmt(row));
  } finally {
    db.close();
  }
}
