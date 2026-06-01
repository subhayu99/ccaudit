import { describe, it, expect } from "vitest";
import { buildPlist, WATCH_LABEL } from "../src/lib/launchd.js";

describe("buildPlist", () => {
  const xml = buildPlist({
    label: WATCH_LABEL, nodePath: "/usr/bin/node", cliPath: "/pkg/dist/index.js",
    interval: 30, logPath: "/home/.ccaudit/logs/watch.log",
  });

  it("uses the ccaudit watch label", () => {
    expect(WATCH_LABEL).toBe("com.ccaudit.watch");
    expect(xml).toContain("<string>com.ccaudit.watch</string>");
  });
  it("invokes `node <cli> watch-tick`", () => {
    expect(xml).toContain("<string>/usr/bin/node</string>");
    expect(xml).toContain("<string>/pkg/dist/index.js</string>");
    expect(xml).toContain("<string>watch-tick</string>");
  });
  it("sets the start interval and RunAtLoad", () => {
    expect(xml).toContain("<key>StartInterval</key>");
    expect(xml).toContain("<integer>30</integer>");
    expect(xml).toContain("<key>RunAtLoad</key>");
    expect(xml).toContain("<true/>");
  });
  it("routes stdout+stderr to the log path", () => {
    expect(xml).toContain("<string>/home/.ccaudit/logs/watch.log</string>");
    expect(xml).toContain("<key>StandardErrorPath</key>");
  });
  it("is a well-formed plist document", () => {
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml).toContain("<!DOCTYPE plist");
    expect(xml.trimEnd().endsWith("</plist>")).toBe(true);
  });
});
