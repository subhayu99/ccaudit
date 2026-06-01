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
export function buildResumeCommand(sessionId: string, cwd: string | null): string {
  if (process.platform === "win32") {
    return cwd
      ? `cd ${psQuote(cwd)}\nclaude --resume ${sessionId}`
      : `claude --resume ${sessionId}  # original cwd unknown`;
  }
  return cwd
    ? `cd ${posixQuote(cwd)}\nclaude --resume ${sessionId}`
    : `claude --resume ${sessionId}  # original cwd unknown`;
}
