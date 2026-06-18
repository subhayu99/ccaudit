import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  existsSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Encode an absolute directory to Claude Code's project-folder name: `/` and `.`
 * both become `-`. e.g. `/Users/me/.x/proj` → `-Users-me--x-proj`. This matches the
 * scheme observed in ~/.claude/projects/ (it's lossy, but encoding forward is exact).
 */
export function encodeProjectDir(absDir: string): string {
  return absDir.replace(/[/.]/g, "-");
}

/**
 * Rewrite the `cwd` field on each JSONL line from `oldCwd` to `newCwd`. Lines that
 * aren't JSON, or whose `cwd` isn't exactly `oldCwd`, pass through untouched — so we
 * never corrupt content or rewrite unrelated paths.
 */
export function rewriteSessionCwd(
  jsonl: string,
  oldCwd: string,
  newCwd: string
): { content: string; rewritten: number } {
  const lines = jsonl.split("\n");
  let rewritten = 0;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return line; // not JSON — leave as-is
    }
    if (typeof obj.cwd === "string" && obj.cwd === oldCwd) {
      obj.cwd = newCwd;
      rewritten++;
      return JSON.stringify(obj);
    }
    return line;
  });
  return { content: out.join("\n"), rewritten };
}

export type RehomeResult = {
  sourceFile: string;
  targetFile: string;
  backupFile: string;
  linesRewritten: number;
  lineCount: number;
};

const countLines = (s: string) => s.split("\n").filter((l) => l.length > 0).length;

/**
 * Move a session's JSONL into the target directory's Claude project folder and rewrite
 * its `cwd`, so `claude --resume` finds it from the real working directory.
 *
 * Safety contract (the original is never at risk):
 *   1. Refuse if the destination already holds a file (no clobber).
 *   2. Back up the original first and verify the backup is byte-identical.
 *   3. Write the rewritten file to the destination via a temp file + rename; verify the
 *      line count matches the source.
 *   4. Only AFTER the destination is verified do we delete the original.
 * Any failure throws with the original still in place (and a backup already made).
 *
 * Caller MUST ensure the session is not currently running before calling this.
 */
export function rehomeSession(args: {
  sessionId: string;
  sourceFile: string;
  oldCwd: string;
  targetDir: string; // absolute
  projectsRoot: string; // ~/.claude/projects
  backupDir: string; // ~/.ccaudit/backups/rehome
  stamp: string; // timestamp for the backup filename (injected for determinism)
}): RehomeResult {
  const { sessionId, sourceFile, oldCwd, targetDir, projectsRoot, backupDir, stamp } = args;

  if (!existsSync(sourceFile)) throw new Error(`source session file not found: ${sourceFile}`);
  const original = readFileSync(sourceFile, "utf8");
  const srcLineCount = countLines(original);

  const targetFolder = join(projectsRoot, encodeProjectDir(targetDir));
  const targetFile = join(targetFolder, `${sessionId}.jsonl`);
  if (targetFile === sourceFile) throw new Error("the session already lives in that directory");
  if (existsSync(targetFile)) {
    throw new Error(`destination already has a file for this session: ${targetFile} — not overwriting`);
  }

  // 1. Back up first, verify byte-identical.
  mkdirSync(backupDir, { recursive: true });
  const backupFile = join(backupDir, `${stamp}-${sessionId}.jsonl`);
  copyFileSync(sourceFile, backupFile);
  if (!existsSync(backupFile) || readFileSync(backupFile, "utf8") !== original) {
    throw new Error("backup verification failed — aborted, nothing moved");
  }

  // 2. Rewrite cwd in-memory.
  const { content, rewritten } = rewriteSessionCwd(original, oldCwd, targetDir);

  // 3. Write destination atomically (tmp → rename), verify line count.
  mkdirSync(targetFolder, { recursive: true });
  const tmp = `${targetFile}.tmp`;
  writeFileSync(tmp, content, "utf8");
  if (countLines(readFileSync(tmp, "utf8")) !== srcLineCount) {
    rmSync(tmp, { force: true });
    throw new Error("written file line count did not match source — aborted, nothing moved");
  }
  renameSync(tmp, targetFile);

  // 4. Destination verified + backup exists → safe to remove the original.
  if (existsSync(targetFile)) rmSync(sourceFile, { force: true });

  return { sourceFile, targetFile, backupFile, linesRewritten: rewritten, lineCount: srcLineCount };
}
