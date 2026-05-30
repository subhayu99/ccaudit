// ccaudit's own AI features shell out to `claude -p`, and each such call creates its OWN
// session log under ~/.claude/projects/. Left unchecked, those meta-sessions get indexed as
// junk (titled with our own prompt text). We detect them by the distinctive opening line of
// each tool prompt and exclude them from the index. These phrases only ever appear as the
// FIRST user message of a ccaudit-spawned session, never in real developer work.

const SIGNATURES: RegExp[] = [
  /You are titling \d+ of a developer's Claude Code session/i, // name-sessions
  /You are labeling segments of a developer's Claude Code session/i, // label-segments
  /\bdeveloper coding-session titles\b/i, // cluster-topics / assign
  /excerpts below, retrieved from their Claude Code session history/i, // ask
];

/** True if `firstUserText` is one of ccaudit's own `claude -p` tool prompts. */
export function isInternalToolPrompt(firstUserText: string | null | undefined): boolean {
  if (!firstUserText) return false;
  return SIGNATURES.some((re) => re.test(firstUserText));
}
