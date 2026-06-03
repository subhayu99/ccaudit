import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

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

/** Combined status for the UI — one place so callers don't double-spawn `claude`. */
export async function mcpStatus(): Promise<{ claudeAvailable: boolean; registered: boolean }> {
  const claudeAvailable = await isClaudeCliAvailable();
  const registered = claudeAvailable ? await isMcpRegistered() : false;
  return { claudeAvailable, registered };
}

/**
 * The ccaudit CLI entry that `claude` should spawn (`node <cli> mcp`).
 *
 * `/api/*` routes run inside the Astro SSR child, where `process.argv[1]` is the
 * web-server entry — NOT the ccaudit CLI. `ccaudit serve` therefore forwards the
 * real CLI path via CCAUDIT_CLI_PATH (see serve.ts). Falls back to a built
 * `dist/index.js` under the cwd for `astro dev`. Returns null if neither is found.
 */
export function resolveCliPath(): string | null {
  const fromEnv = process.env.CCAUDIT_CLI_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const local = join(process.cwd(), "dist", "index.js");
  if (existsSync(local)) return local;
  return null;
}
