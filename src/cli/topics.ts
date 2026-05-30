import kleur from "kleur";
import { openDb } from "../db/init.js";
import { listTopics } from "../db/topics.js";
import { INDEX_DB_PATH } from "../paths.js";

export async function topicsCommand(): Promise<void> {
  const db = openDb(INDEX_DB_PATH);
  try {
    const topics = listTopics(db);
    if (topics.length === 0) {
      console.log("(no topics — run clustering from the web UI: `ccaudit serve`)");
      return;
    }
    const headers = ["SESSIONS", "TOPIC"];
    const dataRows = topics.map((t) => [String(t.sessionCount), t.name]);
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...dataRows.map((row) => row[i]!.length))
    );
    const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
    console.log(kleur.bold(fmt(headers)));
    for (const row of dataRows) console.log(fmt(row));
  } finally {
    db.close();
  }
}
