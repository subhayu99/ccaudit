import { posixQuote } from "./shell.js";

/** Quote a string as a PowerShell single-quoted literal (embedded `'` is doubled). */
function psQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

/**
 * The two-line `cd <dir>` / `claude --resume <id>` snippet shown in the UI. Pass `cwd=null`
 * when the original directory is unknown or no longer on disk (caller checks
 * existsSync). On POSIX the cwd is single-quoted; on Windows it's emitted as a
 * PowerShell snippet (cwd PowerShell-quoted) so it pastes safely into pwsh.
 */
export function buildResumeCommand(sessionId: string, cwd: string | null, provider: "claude" | "codex" = "claude"): string {
  const nativeId = provider === "codex" ? sessionId.replace(/^codex:/, "") : sessionId;
  const safe = /^[A-Za-z0-9_-]+$/.test(nativeId);
  const arg = safe ? nativeId : process.platform === "win32" ? psQuote(nativeId) : posixQuote(nativeId);
  const resume = provider === "codex" ? `codex resume ${arg}` : `claude --resume ${arg}`;
  if (process.platform === "win32") {
    return cwd
      ? `cd ${psQuote(cwd)}\n${resume}`
      : `${resume}  # original cwd unknown`;
  }
  return cwd
    ? `cd ${posixQuote(cwd)}\n${resume}`
    : `${resume}  # original cwd unknown`;
}
