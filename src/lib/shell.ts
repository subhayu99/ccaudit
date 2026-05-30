// POSIX-quote a string for safe inclusion in a shell command.
//
// Wraps the value in single quotes and escapes any embedded single quote
// using the canonical '\'' idiom. Inside single quotes the shell performs no
// expansion, so $, ;, &&, spaces, etc. are all treated literally — this
// prevents shell injection when interpolating untrusted paths (e.g. a session
// cwd) into a `cd <dir>` command.
export function posixQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
