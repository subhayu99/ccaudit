import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { getSession } from "../db/sessions.js";
import { getSessionMessages } from "../db/messages.js";
import { INDEX_DB_PATH, EXPORTS_DIR } from "../paths.js";
import {
  renderSessionMarkdown,
  renderSessionHtml,
  exportFilename,
  type ExportFormat,
} from "../lib/session-export.js";

export async function exportCommand(
  sessionId: string,
  opts: { format?: string; out?: string; raw?: boolean }
): Promise<void> {
  const format = (opts.format ?? "md").toLowerCase();
  if (format !== "md" && format !== "html") {
    console.error(kleur.red(`✗ --format must be "md" or "html" (got "${format}")`));
    process.exit(1);
  }

  const db = openDb(INDEX_DB_PATH);
  try {
    const session = getSession(db, sessionId);
    if (!session) {
      console.error(kleur.red(`✗ No indexed session with id ${sessionId}`));
      console.error(kleur.dim("  Run `ccaudit list` to find the full session id."));
      process.exit(1);
    }
    const messages = getSessionMessages(db, sessionId);
    const content =
      format === "html"
        ? await renderSessionHtml(session, messages, { raw: opts.raw })
        : renderSessionMarkdown(session, messages, { raw: opts.raw });

    const outPath = opts.out ?? join(EXPORTS_DIR, exportFilename(session, format as ExportFormat));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, content, "utf8");
    console.log(kleur.green(`✓ Exported ${format.toUpperCase()} → ${outPath}`));
  } finally {
    db.close();
  }
}
