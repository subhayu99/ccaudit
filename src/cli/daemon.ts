import { spawn } from "node:child_process";
import { openSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import kleur from "kleur";
import { readServeState, clearServeState, isServeUp } from "../lib/runtime.js";
import { openInBrowser } from "../lib/open-browser.js";
import { sqliteChildArgs } from "../lib/sqlite-runtime.js";
import { LOGS_DIR } from "../paths.js";

/**
 * `ccaudit start` — run the UI in the background so it survives closing the terminal.
 *
 * Spawns a detached `ccaudit serve` whose stdout/stderr go to a log file. That child
 * writes serve.json (pid/port) on boot and, on SIGTERM, clears it and kills its own
 * Astro child — so `ccaudit stop` is a clean teardown. We wait until the server actually
 * answers before reporting success and opening the browser.
 *
 * Not boot-persistent (that's the opt-in macOS `ccaudit watch`); this just outlives the shell.
 */
export async function startCommand(opts: { port?: string; open?: boolean } = {}): Promise<void> {
  const existing = readServeState();
  if (existing && (await isServeUp(existing.url))) {
    console.log(kleur.green(`✓ ccaudit is already running at ${kleur.reset(existing.url)}`));
    if (opts.open !== false) openInBrowser(existing.url);
    return;
  }

  const cliPath = process.argv[1];
  if (!cliPath) {
    console.error(kleur.red("✗ Can't locate the ccaudit CLI to launch in the background."));
    process.exit(1);
  }
  const port = opts.port ?? "4321";
  mkdirSync(LOGS_DIR, { recursive: true });
  const logPath = join(LOGS_DIR, "serve.log");
  const out = openSync(logPath, "a");

  const child = spawn(
    process.execPath,
    [...sqliteChildArgs(), cliPath, "serve", "--port", port, "--no-open"],
    { detached: true, stdio: ["ignore", out, out], windowsHide: true }
  );
  child.on("error", (err) => {
    console.error(kleur.red(`✗ Failed to launch ccaudit: ${err.message}`));
    process.exit(1);
  });
  child.unref();

  const url = `http://127.0.0.1:${port}`;
  process.stdout.write(kleur.dim("Starting ccaudit in the background"));
  const deadline = Date.now() + 60_000; // first run indexes before listening
  while (Date.now() < deadline) {
    if (await isServeUp(url)) {
      process.stdout.write("\n");
      console.log(kleur.green(`✓ ccaudit is running at ${kleur.reset(url)}`));
      console.log(kleur.dim(`  stop: ccaudit stop · status: ccaudit status · logs: ${logPath}`));
      if (opts.open !== false) openInBrowser(url);
      return;
    }
    process.stdout.write(kleur.dim("."));
    await wait(700);
  }
  process.stdout.write("\n");
  console.error(kleur.red(`✗ ccaudit didn't come up within 60s — check the log: ${logPath}`));
  process.exit(1);
}

/** `ccaudit stop` — terminate the background server recorded in serve.json. */
export async function stopCommand(): Promise<void> {
  const state = readServeState();
  if (!state) {
    console.log(kleur.dim("ccaudit isn't running in the background (no serve state found)."));
    return;
  }
  try {
    process.kill(state.pid, "SIGTERM"); // serve's handler clears state + kills its Astro child
    console.log(kleur.green(`✓ Stopped ccaudit (pid ${state.pid}).`));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ESRCH") {
      console.log(kleur.dim(`ccaudit (pid ${state.pid}) wasn't running — clearing stale state.`));
    } else {
      console.error(kleur.red(`Couldn't stop pid ${state.pid}: ${err.message}`));
    }
  }
  clearServeState(); // belt-and-suspenders in case the process was already gone
}

/** `ccaudit status` — is the background server up, and where? */
export async function statusCommand(): Promise<void> {
  const state = readServeState();
  if (state && (await isServeUp(state.url))) {
    console.log(kleur.green("● ccaudit is running"));
    console.log(`  ${kleur.bold(state.url)}`);
    console.log(kleur.dim(`  pid ${state.pid} · since ${new Date(state.startedAt).toLocaleString()}`));
    return;
  }
  if (state) {
    console.log(kleur.yellow("○ ccaudit isn't responding (stale serve state)."));
    console.log(kleur.dim("  Relaunch with: ccaudit start"));
    return;
  }
  console.log(kleur.dim("○ ccaudit is not running. Start it with: ccaudit start"));
}
