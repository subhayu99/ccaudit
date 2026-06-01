import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const WATCH_LABEL = "com.ccaudit.watch";

export type BuildPlistOpts = {
  label: string;
  nodePath: string;
  cliPath: string;
  interval: number;
  logPath: string;
};

/** Render the LaunchAgent plist XML. Pure — snapshot-tested. */
export function buildPlist(o: BuildPlistOpts): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${o.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${o.nodePath}</string>
    <string>${o.cliPath}</string>
    <string>watch-tick</string>
  </array>
  <key>StartInterval</key>
  <integer>${o.interval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${o.logPath}</string>
  <key>StandardErrorPath</key>
  <string>${o.logPath}</string>
</dict>
</plist>
`;
}

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${WATCH_LABEL}.plist`);
}

/** Whether our LaunchAgent plist is present on disk. */
export function agentInstalled(): boolean {
  return existsSync(plistPath());
}

/**
 * Write the plist and (re)load it via launchctl. macOS only — callers guard the
 * platform. Returns the plist path. Throws if launchctl fails (caller surfaces it).
 */
export function installAgent(opts: { nodePath: string; cliPath: string; logPath: string; interval?: number }): string {
  const path = plistPath();
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(dirname(opts.logPath), { recursive: true });
  writeFileSync(path, buildPlist({
    label: WATCH_LABEL, nodePath: opts.nodePath, cliPath: opts.cliPath,
    interval: opts.interval ?? 30, logPath: opts.logPath,
  }));
  const domain = `gui/${process.getuid?.() ?? 0}`;
  // Re-bootstrap cleanly: ignore a "not loaded" bootout error, then bootstrap.
  try { execFileSync("launchctl", ["bootout", `${domain}/${WATCH_LABEL}`], { stdio: "ignore" }); } catch { /* not loaded */ }
  execFileSync("launchctl", ["bootstrap", domain, path], { stdio: "ignore" });
  return path;
}

/** Unload and remove the LaunchAgent. Best-effort. */
export function uninstallAgent(): void {
  const path = plistPath();
  const domain = `gui/${process.getuid?.() ?? 0}`;
  try { execFileSync("launchctl", ["bootout", `${domain}/${WATCH_LABEL}`], { stdio: "ignore" }); } catch { /* not loaded */ }
  try { rmSync(path, { force: true }); } catch { /* already gone */ }
}
