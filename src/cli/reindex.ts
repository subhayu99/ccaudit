import { openDb } from "../db/init.js";
import { indexAll } from "../indexer/index-runner.js";
import { createIndexReporter } from "./index-reporter.js";
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR } from "../paths.js";

export async function reindexCommand(opts: { force?: boolean }): Promise<void> {
  const db = openDb(INDEX_DB_PATH);
  const reporter = createIndexReporter();
  try {
    const start = Date.now();
    const stats = await indexAll(db, {
      baseDir: CLAUDE_PROJECTS_DIR,
      force: !!opts.force,
      onProgress: reporter.onProgress,
    });
    reporter.stop();
    const ms = Date.now() - start;
    console.log(
      `Reindex complete in ${ms}ms — indexed ${stats.sessionsIndexed} session(s), ` +
        `skipped ${stats.sessionsSkipped}, malformed lines: ${stats.malformedLines}, errors: ${stats.errors}` +
        (stats.inferenceBackfilled ? `, work-dir inference back-filled for ${stats.inferenceBackfilled}` : "") +
        `.`
    );
  } finally {
    db.close();
  }
}
