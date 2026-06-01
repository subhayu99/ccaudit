import kleur from "kleur";
import { existsSync } from "node:fs";
import { openDb } from "../db/init.js";
import { readLiveRegistry } from "../watch/registry.js";
import { listLive } from "../db/live-sessions.js";
import { buildResumeCommand } from "../lib/resume.js";
import { getBootTime } from "../lib/boot-time.js";
import { relativeTime } from "../lib/render.js";
import { INDEX_DB_PATH } from "../paths.js";

const DAY = 86_400_000;

function row(cells: string[], widths: number[]): string {
  return cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
}

export function liveCommand(): void {
  const db = openDb(INDEX_DB_PATH);
  try {
    const now = Date.now();
    const reg = readLiveRegistry({ bootTime: getBootTime(now) });
    const regIds = new Set(reg.map((r) => r.sessionId));
    const history = listLive(db, { endedSince: now - DAY });
    const dbById = new Map(history.map((r) => [r.sessionId, r]));

    const running = reg.map((inst) => {
      const dbRow = dbById.get(inst.sessionId);
      return {
        sessionId: inst.sessionId, name: inst.name ?? dbRow?.name ?? null,
        cwd: inst.cwd ?? dbRow?.cwd ?? null, status: inst.status,
        startedAt: inst.startedAt ?? dbRow?.startedAt ?? null,
      };
    });
    const recentlyEnded = history.filter((r) => r.endedAt !== null && !regIds.has(r.sessionId));

    if (running.length === 0 && recentlyEnded.length === 0) {
      console.log("No running or recently-ended Claude Code sessions.");
      console.log(kleur.dim("Install the watcher to keep this across restarts: ccaudit watch --install"));
      return;
    }

    if (running.length) {
      console.log(kleur.bold(kleur.green(`● Running now (${running.length})`)));
      const headers = ["DIR", "NAME", "STATUS", "STARTED"];
      const data = running.map((r) => [
        r.cwd ?? "—", (r.name ?? "—").slice(0, 32), r.status ?? "—",
        r.startedAt ? relativeTime(r.startedAt, now) : "—",
      ]);
      const widths = headers.map((h, i) => Math.max(h.length, ...data.map((d) => d[i]!.length)));
      console.log(kleur.dim(row(headers, widths)));
      for (const d of data) console.log(row(d, widths));
      console.log();
      console.log(kleur.dim("Resume:"));
      for (const r of running) {
        const cwd = r.cwd && existsSync(r.cwd) ? r.cwd : null;
        console.log(kleur.dim("  " + buildResumeCommand(r.sessionId, cwd).replace("\n", "  ")));
      }
    }

    if (recentlyEnded.length) {
      console.log();
      console.log(kleur.bold(kleur.yellow(`○ Recently ended (${recentlyEnded.length})`)));
      for (const r of recentlyEnded) {
        const when = r.endedReason === "restart" ? "ended at your last restart" : `ended ${relativeTime(r.endedAt, now)}`;
        console.log(`  ${kleur.dim(r.cwd ?? "—")}  ${r.name ?? ""}  ${kleur.dim("· " + when)}`);
      }
    }
  } finally {
    db.close();
  }
}
