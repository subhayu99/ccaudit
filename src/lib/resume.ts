import { posixQuote } from "./shell.js";

/**
 * The two-line `cd <dir>` / `claude --resume <id>` snippet shown in the UI. Pass `cwd=null`
 * when the original directory is unknown or no longer on disk (caller checks
 * existsSync); the cwd is POSIX-quoted to stay injection-safe.
 */
export function buildResumeCommand(sessionId: string, cwd: string | null): string {
  return cwd
    ? `cd ${posixQuote(cwd)}\nclaude --resume ${sessionId}`
    : `claude --resume ${sessionId}  # original cwd unknown`;
}
