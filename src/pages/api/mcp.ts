import type { APIRoute } from "astro";
import { mcpStatus, installMcp, uninstallMcp, manualCommand, resolveCliPath } from "../../lib/mcp-install.js";

/**
 * Connect/disconnect ccaudit as an MCP server in Claude Code — the web-UI path
 * for the same thing `ccaudit mcp --install` does from the terminal. All work is
 * delegated to the user's own `claude` CLI (`claude mcp add/remove`), so the
 * config is written correctly cross-platform. Same-origin only.
 *
 * GET   → { claudeAvailable, registered, manualCommand } (status for the button)
 * POST  → { action: "install" | "uninstall" }
 */

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

// `claude mcp get/--version` spawn a subprocess; the sidebar fetches status on
// every page load. Cache briefly (registration rarely changes) and bust on POST.
let cache: { at: number; val: { claudeAvailable: boolean; registered: boolean } } | null = null;
const TTL = 60_000;

async function status(): Promise<{ claudeAvailable: boolean; registered: boolean }> {
  if (cache && Date.now() - cache.at < TTL) return cache.val;
  const val = await mcpStatus();
  cache = { at: Date.now(), val };
  return val;
}

export const GET: APIRoute = async () => {
  const s = await status();
  const cli = resolveCliPath();
  return json({ ...s, manualCommand: cli ? manualCommand(process.execPath, cli) : null });
};

export const POST: APIRoute = async ({ request }) => {
  let action = "";
  try { action = (((await request.json()) as { action?: string }).action ?? "").toLowerCase(); } catch { /* empty body */ }

  if (action === "uninstall") {
    try {
      await uninstallMcp();
      cache = null;
      return json({ ok: true, registered: false });
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500);
    }
  }

  if (action === "install") {
    const cli = resolveCliPath();
    if (!cli) {
      return json({ ok: false, error: "Couldn't locate the ccaudit CLI. From a terminal run: ccaudit mcp --install" }, 400);
    }
    const { claudeAvailable, registered } = await status();
    if (!claudeAvailable) {
      // Not an error — just can't automate it. Hand back the exact command to paste.
      return json({ ok: false, claudeAvailable: false, manualCommand: manualCommand(process.execPath, cli) });
    }
    if (registered) return json({ ok: true, registered: true, already: true });
    try {
      await installMcp(process.execPath, cli);
      cache = null;
      return json({ ok: true, registered: true });
    } catch (e) {
      return json({ ok: false, manualCommand: manualCommand(process.execPath, cli), error: (e as Error).message }, 500);
    }
  }

  return json({ ok: false, error: "unknown action" }, 400);
};
