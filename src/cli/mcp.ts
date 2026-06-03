import kleur from "kleur";
import { createInterface } from "node:readline";
import { startMcpServer } from "../mcp/server.js";
import { isClaudeCliAvailable, isMcpRegistered, installMcp, uninstallMcp, manualCommand } from "../lib/mcp-install.js";

function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); const x = a.trim().toLowerCase(); resolve(x === "" || x === "y" || x === "yes"); });
  });
}

export async function mcpCommand(opts: { install?: boolean; uninstall?: boolean } = {}): Promise<void> {
  const nodePath = process.execPath;
  const cliPath = process.argv[1] ?? "";

  if (opts.uninstall) {
    try { await uninstallMcp(); console.log(kleur.green("✓ Removed ccaudit from Claude Code's MCP servers.")); }
    catch (e) { console.error(kleur.red(`Couldn't remove it: ${(e as Error).message}`)); process.exitCode = 1; }
    return;
  }

  if (opts.install) {
    if (!(await isClaudeCliAvailable())) {
      console.log(kleur.yellow("The `claude` CLI isn't on your PATH — add ccaudit to Claude Code manually:"));
      console.log("  " + kleur.bold(manualCommand(nodePath, cliPath)));
      return;
    }
    if (await isMcpRegistered()) {
      console.log(kleur.dim("ccaudit is already registered in Claude Code. (`ccaudit mcp --uninstall` to remove)"));
      return;
    }
    console.log(kleur.dim("This registers ccaudit as a user-scope MCP server in Claude Code so Claude can query your"));
    console.log(kleur.dim("session history. Runs locally, nothing is uploaded, and it's reversible (`--uninstall`)."));
    const ok = process.stdin.isTTY ? await askYesNo(kleur.bold("Add ccaudit to Claude Code? ") + kleur.dim("[Y/n] ")) : true;
    if (!ok) { console.log(kleur.dim("Skipped.")); return; }
    try {
      await installMcp(nodePath, cliPath);
      console.log(kleur.green("✓ Added. Restart Claude Code (or run /mcp) to pick up ccaudit's tools."));
    } catch (e) {
      console.error(kleur.red(`Couldn't register it: ${(e as Error).message}`));
      console.log(kleur.dim("Do it manually with:"));
      console.log("  " + kleur.bold(manualCommand(nodePath, cliPath)));
      process.exitCode = 1;
    }
    return;
  }

  // Default: run the MCP server. stdio is the MCP channel — do not write anything else to stdout.
  await startMcpServer();
}
