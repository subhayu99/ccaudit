import kleur from "kleur";
import { join } from "node:path";
import { openDb } from "../db/init.js";
import { readLiveRegistry } from "../watch/registry.js";
import { runWatchTick } from "../watch/tick.js";
import { getBootTime } from "../lib/boot-time.js";
import { listLive } from "../db/live-sessions.js";
import { installAgent, uninstallAgent, agentInstalled, WATCH_LABEL } from "../lib/launchd.js";
import { writeConfig } from "../lib/config.js";
import { INDEX_DB_PATH, LOGS_DIR } from "../paths.js";

const DAY = 86_400_000;

/** Resolve the path the launchd job should run: the CLI bundle node was invoked with. */
function cliEntryPath(): string {
  return process.argv[1] ?? join(process.cwd(), "dist", "index.js");
}

/** Internal: one reconcile pass. Invoked by launchd every interval. */
export function watchTickCommand(): void {
  const db = openDb(INDEX_DB_PATH);
  try {
    const now = Date.now();
    const bootTime = getBootTime(now);
    const summary = runWatchTick(db, { now, bootTime, registry: () => readLiveRegistry({ bootTime }) });
    console.log(`[${new Date(now).toISOString()}] tick — running=${summary.running} endedNow=${summary.endedNow}`);
  } finally {
    db.close();
  }
}

export function watchCommand(opts: { install?: boolean; uninstall?: boolean; status?: boolean }): void {
  if (process.platform !== "darwin" && (opts.install || opts.uninstall)) {
    console.log(kleur.yellow("The background watcher is macOS-only for now."));
    console.log(kleur.dim("The live view still works while ccaudit is open (ccaudit live / the Live page)."));
    return;
  }

  if (opts.uninstall) {
    uninstallAgent();
    writeConfig({ watch: "declined" });
    console.log(kleur.green("✓ Removed the ccaudit session watcher."));
    return;
  }

  if (opts.install) {
    const logPath = join(LOGS_DIR, "watch.log");
    const path = installAgent({ nodePath: process.execPath, cliPath: cliEntryPath(), logPath });
    writeConfig({ watch: "installed" });
    console.log(kleur.green("✓ Installed the ccaudit session watcher.") + kleur.dim(` (${WATCH_LABEL})`));
    console.log(kleur.dim(`  Ticks every 30s · plist ${path} · logs ${logPath}`));
    return;
  }

  // --status (default)
  const installed = agentInstalled();
  const db = openDb(INDEX_DB_PATH);
  try {
    const rows = listLive(db, { endedSince: Date.now() - DAY });
    const running = rows.filter((r) => r.endedAt === null);
    const endedToday = rows.filter((r) => r.endedAt !== null);
    const lastTick = rows.reduce((m, r) => Math.max(m, r.lastSeen), 0);
    console.log(kleur.bold("ccaudit watcher"));
    console.log(`  Installed:    ${installed ? kleur.green("yes") : kleur.yellow("no")}`);
    console.log(`  Running now:  ${running.length}`);
    console.log(`  Ended today:  ${endedToday.length}`);
    console.log(`  Last update:  ${lastTick ? new Date(lastTick).toLocaleString() : "—"}`);
    if (!installed) console.log(kleur.dim("  Install with `ccaudit watch --install` to track sessions across restarts."));
  } finally {
    db.close();
  }
}
