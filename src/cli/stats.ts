import kleur from "kleur";
import { openDb } from "../db/init.js";
import { getIndexStats } from "../db/stats.js";
import { getToolUsage } from "../db/analytics.js";
import { INDEX_DB_PATH } from "../paths.js";

function fmtDate(ms: number | null): string {
  return ms ? new Date(ms).toISOString().slice(0, 19).replace("T", " ") : "—";
}

export async function statsCommand(): Promise<void> {
  const db = openDb(INDEX_DB_PATH);
  try {
    const stats = getIndexStats(db);
    if (stats.totalSessions === 0) {
      console.log("(no sessions indexed — run `ccaudit reindex`)");
      return;
    }

    console.log(kleur.bold("Index summary"));
    console.log(`  Total sessions:        ${kleur.cyan(String(stats.totalSessions))}`);
    console.log(`  Total messages:        ${kleur.cyan(String(stats.totalMessages))}`);
    console.log(`  Sessions w/ compacts:  ${kleur.cyan(String(stats.sessionsWithCompacts))}`);
    console.log(`  Date range:            ${fmtDate(stats.oldestSession)} → ${fmtDate(stats.newestSession)}`);

    const tools = getToolUsage(db).slice(0, 10);
    if (tools.length > 0) {
      console.log();
      console.log(kleur.bold("Top tools"));
      const width = Math.max(...tools.map((t) => t.tool.length));
      for (const t of tools) {
        console.log(`  ${t.tool.padEnd(width)}  ${kleur.dim(String(t.count))}`);
      }
    }
  } finally {
    db.close();
  }
}
