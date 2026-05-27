import { defineMiddleware } from "astro:middleware";
import { openDb } from "./db/init.js";
import { indexAll } from "./indexer/index-runner.js";
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR } from "./paths.js";

let hasIndexed = false;

export const onRequest = defineMiddleware(async (_context, next) => {
  if (!hasIndexed) {
    hasIndexed = true;
    const db = openDb(INDEX_DB_PATH);
    try {
      const stats = await indexAll(db, { baseDir: CLAUDE_PROJECTS_DIR });
      console.log(
        `[ccaudit] Auto-reindex: ${stats.sessionsIndexed} indexed, ${stats.sessionsSkipped} skipped`
      );
    } finally {
      db.close();
    }
  }
  return next();
});
