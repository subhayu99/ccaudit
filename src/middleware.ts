import { defineMiddleware } from "astro:middleware";
import { getDb } from "./db/init.js";
import { indexAll } from "./indexer/index-runner.js";
import { shouldAutoIndex } from "./lib/auto-index.js";

let hasIndexed = false;

export const onRequest = defineMiddleware(async (_context, next) => {
  // In production `ccaudit serve`, the supervisor process pre-indexes and then keeps the index
  // fresh with a periodic pass, and it sets CCAUDIT_PREINDEXED=1 for this web child — so the child
  // must never index (node:sqlite is synchronous; an index pass here would freeze HTTP). Only plain
  // `astro dev` (no supervisor, flag absent) indexes on first request.
  if (!hasIndexed) {
    hasIndexed = true;
    if (shouldAutoIndex(process.env)) {
      try {
        // Share the process-wide handle (never closed) so subsequent SSR reads reuse it.
        const db = getDb();
        const stats = await indexAll(db, {});
        console.log(
          `[ccaudit] Auto-reindex: ${stats.sessionsIndexed} indexed, ${stats.sessionsSkipped} skipped`
        );
      } catch (err) {
        hasIndexed = false; // transient failure — retry on the next request
        console.error(`[ccaudit] Auto-reindex failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  return next();
});
