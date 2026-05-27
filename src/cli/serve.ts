import { spawn, exec } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kleur from "kleur";
import { openDb } from "../db/init.js";
import { indexAll } from "../indexer/index-runner.js";
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR } from "../paths.js";
import { setTimeout as wait } from "node:timers/promises";

function findProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "astro.config.mjs"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("Cannot find ccaudit project root (astro.config.mjs not found)");
}

export async function serveCommand(opts: { port?: string; open?: boolean }): Promise<void> {
  const port = opts.port ?? "4321";
  const root = findProjectRoot();

  console.log(kleur.dim("Indexing sessions..."));
  const db = openDb(INDEX_DB_PATH);
  try {
    const stats = await indexAll(db, { baseDir: CLAUDE_PROJECTS_DIR });
    console.log(
      kleur.dim(`  ${stats.sessionsIndexed} indexed, ${stats.sessionsSkipped} skipped`)
    );
  } finally {
    db.close();
  }

  console.log(kleur.dim(`Starting server on http://127.0.0.1:${port} ...`));
  const server = spawn("npx", ["astro", "dev", "--port", port, "--host", "127.0.0.1"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env },
  });

  if (opts.open !== false && !process.env.SSH_TTY) {
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          exec(`open "${url}"`);
          break;
        }
      } catch {
        // not ready yet
      }
      await wait(500);
    }
  }

  const cleanup = () => {
    server.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise(() => {});
}
