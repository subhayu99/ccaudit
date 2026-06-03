import kleur from "kleur";
import { readServeState } from "../lib/runtime.js";
import { openInBrowser } from "../lib/open-browser.js";
import { serveCommand } from "./serve.js";

/** Quick liveness probe — does something actually answer at this URL? */
async function isUp(url: string, ms = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.status < 500; // any real HTTP response means the server is up
  } catch {
    return false;
  }
}

/**
 * `ccaudit open` — open the UI in the browser. If an instance is already serving (recorded in
 * ~/.ccaudit/serve.json and confirmed live), just open the browser to it — no re-index, no reboot.
 * Otherwise fall through to a normal `serve` (which indexes, starts, and opens).
 */
export async function openCommand(opts: { port?: string } = {}): Promise<void> {
  const state = readServeState();
  if (state && (await isUp(state.url))) {
    console.log(kleur.dim(`ccaudit is already running — opening ${kleur.reset(state.url)}`));
    openInBrowser(state.url);
    return;
  }
  console.log(kleur.dim("No running ccaudit found — starting one…"));
  await serveCommand({ open: true, port: opts.port });
}
