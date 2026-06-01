import kleur from "kleur";
import type { IndexProgress } from "../indexer/index-runner.js";

// A tiny dependency-free progress spinner for the indexing pass. On a TTY it
// renders a single in-place updating line (braille spinner + a rotating, but
// honest, verb + a live count). When stderr is piped/non-interactive it falls
// back to occasional plain lines so logs stay readable.
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// Each verb describes a real step the indexer performs, so the flavour stays truthful.
const VERBS = ["Reading transcripts", "Parsing sessions", "Building the search index", "Cataloguing history"];

export type IndexReporter = {
  onProgress: (p: IndexProgress) => void;
  /** Clear the spinner line and print a final ✓ summary (to stderr). */
  done: (summary: string) => void;
  /** Clear the spinner line without printing — caller prints its own summary. */
  stop: () => void;
};

export function createIndexReporter(): IndexReporter {
  const tty = !!process.stderr.isTTY;
  let phase: IndexProgress["phase"] = "scan";
  let total = 0, current = 0;
  let frame = 0, ticks = 0, verb = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loggedAt = 0;

  const label = () =>
    phase === "scan" ? "Scanning ~/.claude/projects"
    : phase === "resolve" ? "Resolving repositories"
    : VERBS[verb]!;

  const render = () => {
    frame = (frame + 1) % FRAMES.length;
    if (++ticks % 16 === 0) verb = (verb + 1) % VERBS.length; // rotate the verb ~every 1.3s
    const count = phase === "index" && total ? kleur.dim(`  ${current.toLocaleString()} / ${total.toLocaleString()}`) : "";
    process.stderr.write(`\r\x1b[2K${kleur.yellow(FRAMES[frame]!)} ${kleur.dim(label() + "…")}${count}`);
  };

  const onProgress = (p: IndexProgress) => {
    phase = p.phase;
    if (p.phase === "scan") {
      total = p.total;
      if (tty) { if (!timer) timer = setInterval(render, 80); }
      else process.stderr.write(kleur.dim(`  scanning ${total.toLocaleString()} session file(s)…\n`));
    } else if (p.phase === "index") {
      current = p.current; total = p.total;
      if (!tty && current - loggedAt >= 200) { loggedAt = current; process.stderr.write(kleur.dim(`  ${current} / ${total}…\n`)); }
    } else if (p.phase === "resolve") {
      if (!tty) process.stderr.write(kleur.dim(`  resolving repositories…\n`));
    }
  };

  const clear = () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (tty) process.stderr.write("\r\x1b[2K");
  };

  return {
    onProgress,
    stop: clear,
    done: (summary: string) => { clear(); process.stderr.write(kleur.green("✓ ") + summary + "\n"); },
  };
}
