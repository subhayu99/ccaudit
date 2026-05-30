import { defineMiddleware } from "astro:middleware";
import { getDb } from "./db/init.js";
import { indexAll } from "./indexer/index-runner.js";
import { CLAUDE_PROJECTS_DIR } from "./paths.js";

let hasIndexed = false;

export const onRequest = defineMiddleware(async (_context, next) => {
  if (!hasIndexed) {
    // Share the process-wide handle (never closed) so subsequent SSR reads reuse it.
    const db = getDb();
    try {
      const stats = await indexAll(db, { baseDir: CLAUDE_PROJECTS_DIR });
      console.log(
        `[ccaudit] Auto-reindex: ${stats.sessionsIndexed} indexed, ${stats.sessionsSkipped} skipped`
      );
      hasIndexed = true;
    } catch (err) {
      // Leave hasIndexed false so a transient failure retries on the next request.
      console.error(`[ccaudit] Auto-reindex failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return next();
});
