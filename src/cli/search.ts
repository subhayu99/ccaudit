import kleur from "kleur";
import { openDb } from "../db/init.js";
import { searchMessages } from "../db/messages.js";
import { getSession } from "../db/sessions.js";
import { INDEX_DB_PATH } from "../paths.js";
import { clampLimit } from "./limit.js";

function stripMarks(snippet: string): string {
  return snippet.replace(/<\/?mark>/g, "");
}

function highlightForTerminal(snippet: string): string {
  return snippet.replace(/<mark>([^<]+)<\/mark>/g, (_, inner) => kleur.yellow().bold(inner));
}

export async function searchCommand(query: string, opts: { limit?: string }): Promise<void> {
  const db = openDb(INDEX_DB_PATH);
  try {
    const hits = searchMessages(db, query, { limit: clampLimit(opts.limit, 20) });
    if (hits.length === 0) {
      console.log("(no matches)");
      return;
    }
    for (const h of hits) {
      const sess = getSession(db, h.sessionId);
      const label = sess ? `${sess.projectLabel}/${h.sessionId.slice(0, 8)}` : h.sessionId.slice(0, 8);
      console.log(kleur.bold(label) + kleur.dim(` · line ${h.lineNo}`));
      console.log("  " + highlightForTerminal(stripMarks(h.snippet) === h.snippet ? h.snippet : h.snippet));
      console.log();
    }
  } finally {
    db.close();
  }
}
