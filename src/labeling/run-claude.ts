import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Shape of an `execFile` error we care about (plus stderr surfaced by promisify). */
type ExecLikeError = {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stderr?: string;
  message?: string;
};

/** Error thrown when `claude -p` exceeds its timeout. Tagged so callers can map to 504. */
export class ClaudeTimeoutError extends Error {
  readonly isTimeout = true as const;
  constructor(message: string) {
    super(message);
    this.name = "ClaudeTimeoutError";
  }
}

/**
 * Turn a raw execFile rejection into a single, human-readable Error.
 * Pure — unit-tested directly. The three known failure modes:
 *   - ENOENT            -> CLI not installed
 *   - killed/ETIMEDOUT  -> our timeout fired (recognizably typed)
 *   - non-zero exit     -> include trimmed stderr
 */
export function classifyExecError(err: ExecLikeError): Error {
  if (err.code === "ENOENT") {
    return new Error("claude CLI not found on PATH — install Claude Code to enable AI naming");
  }
  if (err.killed || err.code === "ETIMEDOUT") {
    return new ClaudeTimeoutError("claude -p timed out");
  }
  const stderr = (err.stderr ?? "").trim();
  if (typeof err.code === "number" && err.code !== 0) {
    return new Error(`claude -p exited with code ${err.code}${stderr ? `: ${stderr}` : ""}`);
  }
  if (stderr) return new Error(`claude -p failed: ${stderr}`);
  return new Error(err.message ?? "claude -p failed");
}

/** Parse the `claude -p --output-format json` envelope, guarding against non-JSON output. */
export function parseClaudeJson(raw: string): { result?: string; total_cost_usd?: number; is_error?: boolean } {
  try {
    return JSON.parse(raw) as { result?: string; total_cost_usd?: number; is_error?: boolean };
  } catch {
    throw new Error(`claude -p did not return JSON (got: ${raw.slice(0, 200)})`);
  }
}

type ExecFileImpl = typeof execFile;

/**
 * Run the `claude` CLI asynchronously (does NOT block the SSR event loop, unlike execFileSync).
 * Resolves with stdout; rejects with a classified Error on the known failure modes.
 * `execFileImpl` is injectable for tests — production uses node's real execFile.
 */
export async function runClaude(
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number; execFileImpl?: ExecFileImpl } = {}
): Promise<string> {
  const run = promisify(opts.execFileImpl ?? execFile);
  try {
    const { stdout } = await run("claude", args, {
      encoding: "utf8",
      maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 180_000,
    });
    return typeof stdout === "string" ? stdout : String(stdout);
  } catch (err) {
    throw classifyExecError(err as ExecLikeError);
  }
}
