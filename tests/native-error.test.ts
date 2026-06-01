import { describe, it, expect } from "vitest";
import { nativeBindingHelp } from "../src/cli/native-error.js";

// The exact shape of the error a user hit on Node 24 (no prebuilt binary, no build tools).
const FRIEND_ERR = new Error(
  "Could not locate the bindings file. Tried:\n" +
    " → /Users/keshavgarg/node_modules/better-sqlite3/build/better_sqlite3.node\n" +
    " → /Users/keshavgarg/node_modules/better-sqlite3/lib/binding/node-v137-darwin-arm64/better_sqlite3.node"
);

describe("nativeBindingHelp", () => {
  it("detects the better-sqlite3 bindings-not-found error and returns actionable guidance", () => {
    const help = nativeBindingHelp(FRIEND_ERR);
    expect(help).toBeTruthy();
    expect(help!).toContain("better-sqlite3");
    expect(help!).toMatch(/Node 22|Node 24|nvm/); // points at a supported Node
    expect(help!).toMatch(/xcode-select|build-essential/); // build-tools fallback
    expect(help!).toContain(process.version); // shows the user's actual Node version
  });

  it("detects a NODE_MODULE_VERSION ABI mismatch error", () => {
    const e = new Error(
      "The module was compiled against a different Node.js version using NODE_MODULE_VERSION 127. " +
        "This version of Node.js requires NODE_MODULE_VERSION 137."
    );
    expect(nativeBindingHelp(e)).toBeTruthy();
  });

  it("returns null for an unrelated error", () => {
    expect(nativeBindingHelp(new Error("ENOENT: no such file or directory, open 'foo'"))).toBeNull();
  });

  it("tolerates non-Error inputs", () => {
    expect(nativeBindingHelp("some string")).toBeNull();
    expect(nativeBindingHelp(null)).toBeNull();
    expect(nativeBindingHelp(undefined)).toBeNull();
  });
});
