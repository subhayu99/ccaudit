/**
 * Strip Conductor-injected boilerplate from the *start* of a user message so
 * the real prompt becomes the session title / timeline content.
 *
 * Conductor prepends one or more instruction blocks to the first user message:
 *
 *   <system_instruction> You are working inside Conductor... </system_instruction>
 *   <system-instruction> To do immediately: rename the branch... </system-instruction>
 *   /tmp/attachments/pasted_text_....txt
 *   <the actual user ask>
 *
 * We only remove blocks that are *anchored at the start* and have a matching
 * close tag, so a genuine mid-conversation mention of `<system_instruction>`
 * (e.g. a chat discussing this very behavior) is never touched. The raw line
 * is always preserved in `raw_json`.
 */

// A leading <system_instruction>…</system_instruction> or the hyphen variant.
// The backreference \1 forces the close tag to match the open tag exactly.
const LEADING_INSTRUCTION_BLOCK = /^\s*<(system[_-]instruction)\s*>[\s\S]*?<\/\1\s*>/i;

// A leading line that is solely an attachment path — Conductor pastes these as
// `/tmp/attachments/…` or `…/.context/attachments/…` before the real prompt.
const LEADING_ATTACHMENT_PATH = /^\s*\/\S*attachments\/\S+[ \t]*\r?\n?/i;

// claude-mem observer sessions: every user message is a wrapper around the
// primary session's real request. Anchored at the start so a normal sentence
// mentioning "observe" is never matched.
const OBSERVER_SIGNATURE = /^\s*(Hello memory agent,\s*you are continuing to observe|<observed_from_primary_session>)/i;
const USER_REQUEST = /<user_request>([\s\S]*?)<\/user_request>/i;

// Slash-command echoes Claude Code writes as the first "user" turn.
const COMMAND_ECHO = /^\s*<command-(name|message|args)>/i;

export function cleanPromptText(text: string): string {
  // Observer boilerplate → surface the observed <user_request> (or nothing).
  if (OBSERVER_SIGNATURE.test(text)) {
    const m = text.match(USER_REQUEST);
    return m && m[1]!.trim() ? m[1]!.replace(/\s+/g, " ").trim() : "";
  }

  // Slash-command echoes → surface the command (e.g. "/insights"). Anchored.
  if (COMMAND_ECHO.test(text)) {
    const name = text.match(/<command-name>([\s\S]*?)<\/command-name>/i);
    if (name && name[1]!.trim()) return name[1]!.trim();
    const msg = text.match(/<command-message>([\s\S]*?)<\/command-message>/i);
    if (msg && msg[1]!.trim()) {
      const m = msg[1]!.trim();
      return m.startsWith("/") ? m : "/" + m;
    }
    return "";
  }

  let s = text;
  let prev: string;
  do {
    prev = s;
    s = s.replace(LEADING_INSTRUCTION_BLOCK, "");
    s = s.replace(LEADING_ATTACHMENT_PATH, "");
  } while (s !== prev);
  return s.trim();
}
