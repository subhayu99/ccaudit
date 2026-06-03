import kleur from "kleur";
import { openDb } from "../db/init.js";
import { INDEX_DB_PATH } from "../paths.js";
import { listSessionsNeedingTitle, updateAiTitle } from "../db/sessions.js";
import { nameSessions, type NameItem } from "../labeling/name-sessions.js";
import { buildNameContext } from "../labeling/name-context.js";
import { clampLimit } from "./limit.js";

export async function nameCommand(opts: {
  force?: boolean;
  limit?: string;
  batch?: string;
}): Promise<void> {
  const db = openDb(INDEX_DB_PATH);
  try {
    let targets = listSessionsNeedingTitle(db, !!opts.force);
    if (opts.limit !== undefined) targets = targets.slice(0, clampLimit(opts.limit, targets.length));
    if (targets.length === 0) {
      console.log(kleur.dim("All sessions already have titles. Use --force to regenerate."));
      return;
    }
    const batchSize = clampLimit(opts.batch ?? "20", 20);
    console.log(
      kleur.dim(`Naming ${targets.length} session(s) via claude -p (haiku), ${batchSize}/batch — this costs a few cents and runs for a minute or two.`)
    );

    const items: NameItem[] = targets.map((t) => ({ sessionId: t.id, context: buildNameContext(db, t.id, t.firstPrompt) }));
    let named = 0;
    let totalCost = 0;
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      try {
        const { titles, costUsd } = await nameSessions(chunk);
        totalCost += costUsd;
        chunk.forEach((it, j) => {
          const title = titles[j];
          if (title) { updateAiTitle(db, it.sessionId, title); named += 1; }
        });
        console.log(kleur.dim(`  ${Math.min(i + batchSize, items.length)}/${items.length} done`));
      } catch (e) {
        console.error(kleur.red(`  batch failed: ${e instanceof Error ? e.message : String(e)}`));
      }
    }
    console.log(
      kleur.green(`Named ${named}/${targets.length} session(s).`) +
        kleur.dim(` Estimated cost: $${totalCost.toFixed(4)}.`)
    );
  } finally {
    db.close();
  }
}
