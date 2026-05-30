import { spawn, exec } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { indexAll } from "../indexer/index-runner.js";
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR } from "../paths.js";
import { setTimeout as wait } from "node:timers/promises";

/** Package root = parent of the CLI bundle (dist/index.js → <pkg>). */
function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export async function serveCommand(opts: { port?: string; open?: boolean }): Promise<void> {
  const port = opts.port ?? "4321";
  const root = packageRoot();
  const entry = join(root, "dist-web", "server", "entry.mjs");
  const built = existsSync(entry);

  console.log(kleur.dim("Indexing sessions..."));
  const db = openDb(INDEX_DB_PATH);
  try {
    const stats = await indexAll(db, { baseDir: CLAUDE_PROJECTS_DIR });
    console.log(kleur.dim(`  ${stats.sessionsIndexed} indexed, ${stats.sessionsSkipped} skipped`));
    if (stats.sessionsIndexed === 0 && stats.sessionsSkipped === 0) {
      console.log(kleur.yellow(`  No Claude Code sessions found in ${CLAUDE_PROJECTS_DIR}`));
      console.log(kleur.dim(`  Set CCAUDIT_PROJECTS_DIR to point elsewhere, then re-run.`));
    }
  } finally {
    db.close();
  }

  console.log(kleur.dim(`Starting server on http://127.0.0.1:${port} ...`));
  const server = built
    ? spawn(process.execPath, [entry], {
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
