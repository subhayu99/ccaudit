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

const program = new Command();
program
  .name("ccaudit")
  .description("Browse, search, and audit your Claude Code session history")
  .version("0.1.0");

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

program.parseAsync();
