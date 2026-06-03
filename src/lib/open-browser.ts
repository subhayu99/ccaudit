import { exec } from "node:child_process";

/**
 * Open a URL in the user's default browser, OS-agnostically.
 *   macOS  → `open`
 *   Windows→ `start` (cmd builtin; the empty "" is the window title arg)
 *   Linux  → `xdg-open`
 * Fire-and-forget: failures are non-fatal (caller has already printed the URL).
 */
export function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? `open "${url}"`
    : process.platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd);
}
