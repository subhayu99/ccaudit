import net from "node:net";
import { execFileSync } from "node:child_process";

export type PortHolder = { pid: number; command: string };

/** True if we can bind the port on `host` (i.e. it's free). */
export function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false)); // EADDRINUSE / EACCES → not usable
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

/** First free port at or after `start` (bounded scan), else `start`. */
export async function findFreePort(start: number, host = "127.0.0.1"): Promise<number> {
  for (let p = start; p <= start + 50; p++) {
    if (await isPortFree(p, host)) return p;
  }
  return start;
}

/**
 * Which process is listening on `port`. Uses `lsof` (+`ps` for the full command
 * line), which exist on macOS/Linux; returns null where they don't (e.g. Windows)
 * or when nothing is found — callers degrade to a generic message.
 */
export function whoHasPort(port: number): PortHolder | null {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const pid = parseInt(out.split(/\s+/)[0] ?? "", 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    let command = "";
    try {
      command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      /* ps unavailable — pid alone is still useful */
    }
    return { pid, command };
  } catch {
    return null;
  }
}

/** Plain (colour-free) message explaining the conflict and the two ways out. */
export function formatPortInUse(port: number, holder: PortHolder | null, freePort: number): string {
  const lines = [`Port ${port} is already in use.`];
  if (holder) {
    lines.push(`  Using it:  PID ${holder.pid}${holder.command ? ` — ${holder.command}` : ""}`);
    lines.push(`  Free it:   kill ${holder.pid}`);
  } else {
    lines.push(`  Couldn't identify the process holding it.`);
  }
  lines.push(`  Or pick another port:  ccaudit --port ${freePort}`);
  return lines.join("\n");
}
