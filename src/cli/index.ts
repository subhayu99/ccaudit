import { Command } from "commander";
import { reindexCommand } from "./reindex.js";
import { listCommand } from "./list.js";
import { searchCommand } from "./search.js";
import { doctorCommand } from "./doctor.js";
import { serveCommand } from "./serve.js";
import { mcpCommand } from "./mcp.js";
import { statsCommand } from "./stats.js";
import { topicsCommand } from "./topics.js";
import { nameCommand } from "./name.js";
import { watchCommand, watchTickCommand } from "./watch.js";
import { liveCommand } from "./live.js";
import { openCommand } from "./open.js";
import { exportCommand } from "./export.js";
import { startCommand, stopCommand, statusCommand } from "./daemon.js";
import { nativeBindingHelp } from "./native-error.js";
import { version as pkgVersion } from "../../package.json";
import { spawnSync } from "node:child_process";
import { sqliteNeedsFlag, nodeTooOldForSqlite } from "../lib/sqlite-runtime.js";

// Suppress the experimental-SQLite warning for a clean CLI.
const _emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  const msg = typeof warning === "string" ? warning : (warning as { message?: string })?.message ?? "";
  if (/SQLite is an experimental feature/i.test(msg)) return;
  return (_emitWarning as (w: unknown, ...r: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

// Ensure node:sqlite is usable; on Node 22.5–23.3 transparently re-exec with the flag.
if (nodeTooOldForSqlite()) {
  console.error(`\n✗ ccaudit needs Node 22.5 or newer (you are on ${process.version}).`);
  console.error(`  Install Node 22 LTS or 24:  nvm install 24 && nvm use 24\n`);
  process.exit(1);
} else if (sqliteNeedsFlag()) {
  const res = spawnSync(process.execPath, ["--experimental-sqlite", "--disable-warning=ExperimentalWarning", process.argv[1] ?? "", ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(res.status ?? 0);
}

const program = new Command();
program
  .name("ccaudit")
  .description("Browse, search, and audit your Claude Code session history")
  .version(pkgVersion);

program
  .command("serve", { isDefault: true })
  .description("Start the browser UI (default when no subcommand given)")
  .option("--port <n>", "server port", "4321")
  .option("--no-open", "don't auto-open browser")
  .option("--watch", "install the background session watcher without prompting")
  .option("--no-watch", "skip the watcher prompt and don't ask again (use `ccaudit watch --uninstall` to remove an installed one)")
  .action(serveCommand);

program
  .command("reindex")
  .description("Rebuild the SQLite index from ~/.claude/projects/")
  .option("--force", "re-parse even if file mtime+size are unchanged")
  .action(reindexCommand);

program
  .command("list")
  .description("List indexed sessions in a table")
  .option("--project <dir>", "filter by project directory")
  .option("--limit <n>", "max rows", "30")
  .action(listCommand);

program
  .command("search <query>")
  .description("Full-text search across all indexed sessions")
  .option("--limit <n>", "max hits", "20")
  .action(searchCommand);

program
  .command("stats")
  .description("Show index summary stats and top tool usage")
  .action(statsCommand);

program
  .command("topics")
  .description("List clustered topics with their session counts")
  .action(topicsCommand);

program
  .command("name")
  .description("Generate titles for sessions that lack one, using `claude -p` (haiku)")
  .option("--force", "re-title every session, not just untitled ones")
  .option("--limit <n>", "only title the N most-recent untitled sessions")
  .option("--batch <n>", "sessions per claude call", "20")
  .action(nameCommand);

program
  .command("doctor")
  .description("Diagnose health of the index db and access to ~/.claude/projects/")
  .action(doctorCommand);

program
  .command("mcp")
  .description("Start an MCP stdio server exposing session-history query tools")
  .option("--install", "register ccaudit as an MCP server in Claude Code (asks first; user scope)")
  .option("--uninstall", "remove ccaudit from Claude Code's MCP servers")
  .action(mcpCommand);

program
  .command("watch")
  .description("Install/manage the background watcher that tracks running Claude Code sessions")
  .option("--install", "install the launchd watcher (macOS)")
  .option("--uninstall", "remove the watcher")
  .option("--status", "show watcher status (default)")
  .action(watchCommand);

program
  .command("watch-tick", { hidden: true })
  .description("internal: one reconcile pass (invoked by launchd)")
  .action(watchTickCommand);

program
  .command("live")
  .description("Show running (and recently-ended) Claude Code sessions")
  .action(liveCommand);

program
  .command("open")
  .description("Open the ccaudit UI in your browser — reuses a running instance (no re-index), else starts one")
  .option("--port <port>", "port to use if a new instance must be started")
  .action(openCommand);

program
  .command("start")
  .description("Run the UI in the background (survives closing the terminal) and open it")
  .option("--port <n>", "server port", "4321")
  .option("--no-open", "don't auto-open the browser")
  .action(startCommand);

program
  .command("stop")
  .description("Stop the background ccaudit server")
  .action(stopCommand);

program
  .command("status")
  .description("Show whether ccaudit is running in the background, and where")
  .action(statusCommand);

program
  .command("export <sessionId>")
  .description("Export a session transcript to a Markdown or HTML file")
  .option("--format <fmt>", "md | html", "md")
  .option("--out <path>", "output file path (default: ~/.ccaudit/exports/…)")
  .option("--raw", "include tool calls/results & system turns (default: clean conversation)")
  .action(exportCommand);

program.parseAsync().catch((err) => {
  const help = nativeBindingHelp(err);
  if (help) console.error(help);
  else console.error(err);
  process.exit(1);
});
