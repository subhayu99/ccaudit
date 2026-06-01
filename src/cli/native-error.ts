/**
 * If `err` is a native-module load failure (a prebuilt `.node` binary missing for
 * this Node version + no build tools to compile one), return a friendly, actionable
 * message. Otherwise null. ccaudit's database engine is now Node's built-in
 * node:sqlite (no native module), but a transitive native dep (e.g. sharp, used by
 * Astro for image optimization) could still fail to load — this keeps the raw
 * "Could not locate the bindings file" trace from reaching the user unexplained.
 */
export function nativeBindingHelp(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const isBindingFailure =
    /could not locate the bindings file/i.test(msg) ||
    /better_sqlite3\.node/i.test(msg) ||
    /NODE_MODULE_VERSION/i.test(msg) ||
    /was compiled against a different node\.js version/i.test(msg) ||
    /\.node['"]?\)?\s*$/i.test(msg); // generic "...something.node" load error

  if (!isBindingFailure) return null;

  const where = `${process.platform}-${process.arch}`;
  return [
    "",
    "✗ ccaudit couldn't load a native module it depends on — it needs a binary",
    `  matching your Node.js version (${process.version}, ${where}).`,
    "",
    "  There's no prebuilt binary for your Node version and no build tools to compile",
    "  one. Two easy fixes:",
    "",
    "  1) Use a Node version that ships a prebuilt binary (Node 22 LTS or Node 24):",
    "       nvm install 24 && nvm use 24",
    "       npx @subhayu99/ccaudit@latest",
    "",
    "  2) Or install build tools so it compiles on install, then re-run:",
    "       macOS:  xcode-select --install",
    "       Linux:  sudo apt-get install -y build-essential python3",
    "       npx @subhayu99/ccaudit@latest",
    "",
  ].join("\n");
}
