import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

/**
 * node:sqlite is unflagged on Node 24+, but Node 22.5–23.3 require the
 * --experimental-sqlite flag. Returns true if THIS running process needs it
 * (i.e. node:sqlite can't be required right now and the flag isn't already set).
 */
export function sqliteNeedsFlag(): boolean {
  if (process.execArgv.includes("--experimental-sqlite")) return false;
  try {
    require("node:sqlite");
    return false;
  } catch {
    return true;
  }
}

/** Node major.minor is below 22.5 → node:sqlite doesn't exist at all. */
export function nodeTooOldForSqlite(): boolean {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return (maj ?? 0) < 22 || ((maj ?? 0) === 22 && (min ?? 0) < 5);
}

/** node CLI args for spawning a CHILD that uses node:sqlite quietly (e.g. the SSR server). */
export function sqliteChildArgs(): string[] {
  const args = ["--disable-warning=ExperimentalWarning"];
  if (sqliteNeedsFlag()) args.unshift("--experimental-sqlite");
  return args;
}
