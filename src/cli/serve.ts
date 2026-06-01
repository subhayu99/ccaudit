import { spawn, exec } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { indexAll } from "../indexer/index-runner.js";
import { createIndexReporter } from "./index-reporter.js";
import { isPortFree, findFreePort, whoHasPort, formatPortInUse } from "./port.js";
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR, LOGS_DIR } from "../paths.js";
import { createInterface } from "node:readline";
import { readConfig, writeConfig } from "../lib/config.js";
import { installAgent, agentInstalled } from "../lib/launchd.js";
import { setTimeout as wait } from "node:timers/promises";
import { sqliteChildArgs } from "../lib/sqlite-runtime.js";

/** Package root = parent of the CLI bundle (dist/index.js → <pkg>). */
function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "" || a === "y" || a === "yes"); // default Yes
    });
  });
}

/**
 * Decide whether to install the running-session watcher, asking at most once.
 * --watch installs; --no-watch records a decline; otherwise prompt only on an
 * interactive TTY (headless never prompts). macOS only — a no-op elsewhere.
 */
async function maybeOfferWatch(watch: boolean | undefined): Promise<void> {
  if (process.platform !== "darwin") return;
  const install = () => {
    // argv[1] is the CLI bundle launchd must run. If it's somehow empty (odd
    // embeddings), a plist with an empty program path would "install" but never
    // actually tick — fail loudly instead of silently.
    const cliPath = process.argv[1];
    if (!cliPath) { console.log(kleur.dim("(can't install the watcher: unknown CLI path)")); return; }
    try {
      installAgent({ nodePath: process.execPath, cliPath, logPath: join(LOGS_DIR, "watch.log") });
      writeConfig({ watch: "installed" });
      console.log(kleur.dim("✓ Background watcher installed — your running sessions now survive restarts. (ccaudit watch --uninstall to remove)"));
    } catch (e) {
      console.log(kleur.dim(`(couldn't install the watcher: ${(e as Error).message})`));
    }
  };

  if (watch === true) { if (!agentInstalled()) install(); return; }
  if (watch === false) { writeConfig({ watch: "declined" }); return; }

  const cfg = readConfig();
  if (agentInstalled() || cfg.watch === "installed" || cfg.watch === "declined") return; // asked already

  if (!process.stdin.isTTY) return; // headless: never prompt

  const yes = await askYesNo(kleur.bold("Track your running Claude Code sessions across restarts? ") + kleur.dim("[Y/n] "));
  if (yes) install();
  else { writeConfig({ watch: "declined" }); console.log(kleur.dim("Skipped. Re-run `ccaudit watch --install` any time.")); }
}

export async function serveCommand(opts: { port?: string; open?: boolean; watch?: boolean }): Promise<void> {
  const port = opts.port ?? "4321";
  const root = packageRoot();
  const entry = join(root, "dist-web", "server", "entry.mjs");
  const built = existsSync(entry);

  // Fail fast — before the (possibly slow) indexing pass — if the port is taken,
  // and tell the user exactly what's holding it and how to get unblocked.
  const portNum = Number(port);
  if (!(await isPortFree(portNum))) {
    const holder = whoHasPort(portNum);
    const free = await findFreePort(portNum + 1);
    const [first, ...rest] = formatPortInUse(portNum, holder, free).split("\n");
    console.error(kleur.red("✗ " + first));
    for (const line of rest) console.error(kleur.dim(line));
    process.exit(1);
  }

  await maybeOfferWatch(opts.watch);

  console.log(kleur.bold("ccaudit") + kleur.dim(" · indexing your Claude Code history"));
  console.log(kleur.dim(`${CLAUDE_PROJECTS_DIR} · 100% local, nothing is uploaded · first run only — re-runs are instant`));
  const db = openDb(INDEX_DB_PATH);
  const reporter = createIndexReporter();
  const started = Date.now();
  try {
    const stats = await indexAll(db, { baseDir: CLAUDE_PROJECTS_DIR, onProgress: reporter.onProgress });
    if (stats.sessionsIndexed === 0 && stats.sessionsSkipped === 0) {
      reporter.stop();
      console.log(kleur.yellow(`  No Claude Code sessions found in ${CLAUDE_PROJECTS_DIR}`));
      console.log(kleur.dim(`  Set CCAUDIT_PROJECTS_DIR to point elsewhere, then re-run.`));
    } else {
      const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      const parts = [`Indexed ${stats.sessionsIndexed.toLocaleString()} session${stats.sessionsIndexed === 1 ? "" : "s"}`];
      if (stats.sessionsSkipped) parts.push(`${stats.sessionsSkipped.toLocaleString()} unchanged`);
      if (stats.workdirsResolved) parts.push(`${stats.workdirsResolved} repositor${stats.workdirsResolved === 1 ? "y" : "ies"}`);
      reporter.done(`${parts.join(" · ")} · ${secs}s`);
    }
  } finally {
    db.close();
  }

  console.log(kleur.dim(`Starting server on http://127.0.0.1:${port} ...`));
  const server = built
    ? spawn(process.execPath, [...sqliteChildArgs(), entry], {
        stdio: "inherit",
        env: { ...process.env, HOST: "127.0.0.1", PORT: port },
      })
    : spawn("npx", ["astro", "dev", "--port", port, "--host", "127.0.0.1"], {
        cwd: existsSync(join(root, "astro.config.mjs")) ? root : process.cwd(),
        stdio: "inherit",
        env: { ...process.env },
      });

  // Surface child failures instead of hanging forever.
  server.on("error", (err) => {
    console.error(kleur.red(`Failed to start server: ${err.message}`));
    process.exit(1);
  });
  server.on("exit", (code) => process.exit(code ?? 0));

  if (opts.open !== false && !process.env.SSH_TTY) {
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const cmd =
            process.platform === "darwin" ? `open "${url}"`
            : process.platform === "win32" ? `start "" "${url}"`
            : `xdg-open "${url}"`;
          exec(cmd);
          break;
        }
      } catch { /* not ready yet */ }
      await wait(500);
    }
  }

  const cleanup = () => { server.kill("SIGTERM"); process.exit(0); };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  await new Promise(() => {});
}
