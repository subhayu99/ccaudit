import kleur from "kleur";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { openDb } from "../db/init.js";
import { getSession } from "../db/sessions.js";
import { getSessionMessages } from "../db/messages.js";
import { INDEX_DB_PATH, CLAUDE_PROJECTS_DIR, CCAUDIT_DIR } from "../paths.js";
import { readConfig, writeConfig } from "../lib/config.js";
import { readLiveRegistry } from "../watch/registry.js";
import { getBootTime } from "../lib/boot-time.js";
import { suggestSessionHome } from "../lib/session-dirs.js";
import { rehomeSession } from "../lib/rehome.js";
import { reindexCommand } from "./reindex.js";

function prompt(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
  });
}

const DISCLOSURE =
  kleur.yellow("\n⚠  Re-home moves the real Claude Code session file in your home directory\n") +
  kleur.dim("   (~/.claude/projects/…) and rewrites its working directory — this changes\n" +
            "   Claude's data, not just ccaudit's index.\n\n" +
            "   • The original is backed up first (~/.ccaudit/backups/rehome/)\n" +
            "   • Only ended sessions are moved, never a running one\n" +
            "   • It's worked in testing — but you are modifying Claude's session store.\n");

/**
 * `ccaudit move <sessionId> [targetDir]` — re-home a session that was launched in the
 * wrong directory so `claude --resume` finds it from the dir the work actually happened
 * in. Refuses running sessions, asks one-time consent before touching ~/.claude, backs
 * up the original, then re-indexes.
 */
export async function moveCommand(
  sessionId: string,
  targetDir: string | undefined,
  opts: { yes?: boolean } = {}
): Promise<void> {
  const db = openDb(INDEX_DB_PATH);
  let session, messages;
  try {
    session = getSession(db, sessionId);
    if (!session) {
      console.error(kleur.red(`✗ No indexed session with id ${sessionId}`));
      console.error(kleur.dim("  Run `ccaudit list` to find the full session id."));
      process.exit(1);
    }
    messages = targetDir ? [] : getSessionMessages(db, sessionId);
  } finally {
    db.close();
  }

  // Hard safety rule: never touch a session Claude is actively writing to.
  const running = new Set(readLiveRegistry({ bootTime: getBootTime(Date.now()) }).map((r) => r.sessionId));
  if (running.has(sessionId)) {
    console.error(kleur.red("✗ That session is currently running — close it in Claude Code first, then re-home it."));
    process.exit(1);
  }

  // Resolve the target directory (suggest from the transcript if not given).
  let target = targetDir;
  if (!target) {
    const suggestions = suggestSessionHome(messages, { currentDir: session.cwd });
    if (!suggestions.length) {
      console.error(kleur.red("✗ Couldn't infer where this session worked. Pass the target directory explicitly."));
      process.exit(1);
    }
    console.log(kleur.bold(`This session is filed under ${kleur.reset(session.cwd ?? "(unknown)")}.`));
    console.log("Where did the work actually happen?");
    suggestions.forEach((s, i) => console.log(`  ${kleur.bold(String(i + 1))}. ${s.dir}  ${kleur.dim(`(${s.hits} path refs)`)}`));
    if (!process.stdin.isTTY) {
      console.error(kleur.dim("Non-interactive: pass the target directory explicitly."));
      process.exit(1);
    }
    const pick = await prompt(`Pick 1-${suggestions.length}, or paste a path: `);
    const n = Number(pick);
    target = Number.isInteger(n) && n >= 1 && n <= suggestions.length ? suggestions[n - 1]!.dir : pick;
  }
  if (!target || !existsSync(target)) {
    console.error(kleur.red(`✗ Target directory doesn't exist: ${target ?? "(none)"}`));
    process.exit(1);
  }

  // One-time consent before writing into ~/.claude.
  if (readConfig().rehomeConsent !== "accepted") {
    console.log(DISCLOSURE);
    const ok = opts.yes || (process.stdin.isTTY && /^y(es)?$/i.test(await prompt("Proceed, and don't ask again on this machine? [y/N] ")));
    if (!ok) {
      console.log(kleur.dim("Aborted — nothing was changed."));
      process.exit(1);
    }
    writeConfig({ rehomeConsent: "accepted" });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    const res = rehomeSession({
      sessionId,
      sourceFile: session.filePath,
      oldCwd: session.cwd ?? "",
      targetDir: target,
      projectsRoot: CLAUDE_PROJECTS_DIR,
      backupDir: join(CCAUDIT_DIR, "backups", "rehome"),
      stamp,
    });
    console.log(kleur.green(`✓ Re-homed to ${target}`));
    console.log(kleur.dim(`  file:   ${res.targetFile}`));
    console.log(kleur.dim(`  backup: ${res.backupFile}  (cwd rewritten on ${res.linesRewritten} line${res.linesRewritten === 1 ? "" : "s"})`));
  } catch (e) {
    console.error(kleur.red(`✗ ${(e as Error).message}`));
    process.exit(1);
  }

  console.log(kleur.dim("Re-indexing…"));
  await reindexCommand({});
  console.log(kleur.green(`\nResume it with:  `) + kleur.reset(`cd ${target} && claude --resume ${sessionId}`));
}
