/**
 * Small, dependency-free helpers for keeping the index fresh in the background.
 *
 * - `shouldAutoIndex` lets the web (SSR) child skip indexing when the `serve` parent
 *   already handles it (env flag), so the transcript index is written by exactly one
 *   process. In plain `astro dev` (no supervisor) the flag is absent and the child indexes.
 * - `makePeriodicIndexer` runs an incremental index on a timer with an overlap guard, so a
 *   slow pass never stacks on top of the previous one. node:sqlite is synchronous, so the
 *   caller must run this in a process that isn't also serving HTTP (the idle `serve` parent).
 */

export function shouldAutoIndex(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CCAUDIT_PREINDEXED !== "1";
}

export interface PeriodicIndexer {
  start(): void;
  stop(): void;
}

export function makePeriodicIndexer(
  runIndex: () => Promise<void>,
  opts: { intervalMs: number }
): PeriodicIndexer {
  let running = false;
  let handle: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    if (running) return; // a previous pass is still going — skip this beat
    running = true;
    try {
      await runIndex();
    } catch {
      /* transient (e.g. a busy DB); the next beat retries */
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (handle) return;
      handle = setInterval(() => void tick(), opts.intervalMs);
      // Don't let the timer alone keep the process alive.
      (handle as unknown as { unref?: () => void }).unref?.();
    },
    stop() {
      if (handle) {
        clearInterval(handle);
        handle = null;
      }
    },
  };
}
