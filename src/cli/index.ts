import { Command } from "commander";
import { reindexCommand } from "./reindex.js";
import { listCommand } from "./list.js";
import { searchCommand } from "./search.js";
import { doctorCommand } from "./doctor.js";
import { serveCommand } from "./serve.js";

const program = new Command();
program
  .name("ccaudit")
  .description("Browse, search, and audit your Claude Code session history")
  .version("0.0.1");

program
  .command("serve", { isDefault: true })
  .description("Start the browser UI (default when no subcommand given)")
  .option("--port <n>", "server port", "4321")
  .option("--no-open", "don't auto-open browser")
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
  .command("doctor")
  .description("Diagnose health of the index db and access to ~/.claude/projects/")
  .action(doctorCommand);

program.parseAsync();
