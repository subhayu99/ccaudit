import kleur from "kleur";
import { openDb } from "../db/init.js";
import { getIndexStats } from "../db/stats.js";
import { getToolUsage, getSpend } from "../db/analytics.js";
import { formatUsd } from "../lib/pricing.js";
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

    const spend = getSpend(db);
    if (spend.byModel.length > 0) {
      const fmtTok = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));
      console.log(`  Total tokens:          ${kleur.cyan(fmtTok(spend.totalTokens))}`);
      console.log(`  Est. AI spend:         ${kleur.yellow(formatUsd(spend.totalCostUsd))} ${kleur.dim("(estimated)")}`);
      console.log();
      console.log(kleur.bold("Spend by model") + kleur.dim(" (estimated)"));
      const w = Math.max(...spend.byModel.map((m) => m.model.length));
      for (const m of spend.byModel) {
        console.log(`  ${m.model.padEnd(w)}  ${kleur.yellow(formatUsd(m.costUsd).padStart(9))}  ${kleur.dim(fmtTok(m.tokens) + " tok")}`);
      }
    }

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
