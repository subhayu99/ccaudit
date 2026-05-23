import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

export type AstroDev = {
  proc: ChildProcess;
  url: string;
  stop: () => Promise<void>;
};

/**
 * Spawn `astro dev` on an ephemeral port and wait until it is reachable.
 * env: extra env vars (e.g. CCAUDIT_HOME to point at a test fixture).
 */
export async function startAstroDev(env: Record<string, string> = {}): Promise<AstroDev> {
  // Find a free-ish port by giving Astro one and falling back if needed.
  // For simplicity here, use 14321 (less likely to clash than 4321).
  const port = 14321 + Math.floor(Math.random() * 100);
  const proc = spawn("npx", ["astro", "dev", "--port", String(port), "--host", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const url = `http://127.0.0.1:${port}`;
  // Wait for the server to respond. Poll up to 30s.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url + "/");
      if (res.ok) {
        return {
          proc,
          url,
          stop: async () => {
            proc.kill("SIGTERM");
            await wait(200);
          },
        };
      }
    } catch {
      // not ready yet
    }
    await wait(300);
  }
  proc.kill("SIGKILL");
  throw new Error(`astro dev did not start on ${url} within 30s`);
}
