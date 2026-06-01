import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { uptime } from "node:os";

/** Parse the seconds from macOS `sysctl -n kern.boottime` output. */
export function parseDarwinBoottimeSec(out: string): number | null {
  const m = out.match(/sec\s*=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Machine boot time in epoch ms. macOS via sysctl, Linux via /proc/uptime.
 * Returns 0 on anything unexpected (caller then treats every gone session as
 * 'exited' rather than 'restart' — a safe degradation). `now` is injectable.
 */
export function getBootTime(now: number = Date.now()): number {
  try {
    if (process.platform === "darwin") {
      const out = execFileSync("sysctl", ["-n", "kern.boottime"], { encoding: "utf8" });
      const sec = parseDarwinBoottimeSec(out);
      return sec ? sec * 1000 : 0;
    }
    if (process.platform === "linux") {
      const up = readFileSync("/proc/uptime", "utf8");
      const secs = parseFloat(up.split(/\s+/)[0] ?? "");
      return Number.isFinite(secs) ? now - secs * 1000 : 0;
    }
  } catch { /* fall through to os.uptime() */ }
  // Windows (and any platform without a specific branch): derive boot time from
  // process-runtime os.uptime() in seconds. Falls back to 0 only if non-finite.
  return Number.isFinite(uptime()) ? now - uptime() * 1000 : 0;
}
