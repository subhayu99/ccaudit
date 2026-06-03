import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

/** The server name ccaudit registers under in Claude Code's MCP config. */
export const MCP_NAME = "ccaudit";

/** Args for `claude mcp add` — user scope so ccaudit is available across all projects. */
function addArgs(nodePath: string, cliPath: string): string[] {
  return ["mcp", "add", MCP_NAME, "--scope", "user", "--", nodePath, cliPath, "mcp"];
}

/** The exact command a user can paste if the `claude` CLI isn't on PATH. */
export function manualCommand(nodePath: string, cliPath: string): string {
  return `claude ${addArgs(nodePath, cliPath).join(" ")}`;
}

export async function isClaudeCliAvailable(): Promise<boolean> {
  try { await pexec("claude", ["--version"]); return true; } catch { return false; }
}

/** Already registered? `claude mcp get` exits non-zero when the server is unknown. */
export async function isMcpRegistered(): Promise<boolean> {
  try { await pexec("claude", ["mcp", "get", MCP_NAME]); return true; } catch { return false; }
}

/** Register ccaudit as a user-scope MCP server via Claude's own CLI (manages config cross-OS). */
export async function installMcp(nodePath: string, cliPath: string): Promise<void> {
  await pexec("claude", addArgs(nodePath, cliPath));
}

export async function uninstallMcp(): Promise<void> {
  await pexec("claude", ["mcp", "remove", MCP_NAME, "--scope", "user"]);
}
