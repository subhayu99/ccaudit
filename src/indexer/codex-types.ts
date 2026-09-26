import type { AggregatorState } from "./aggregate.js";
import type { WalkEntry } from "./walk.js";
import type { ParseOptions } from "./parse.js";

/** Codex discovery reads session_meta, never infers identity or cwd from date folders. */
export type CodexEntry = WalkEntry & { provider: "codex" };
export type CodexParseOptions = ParseOptions;
export type CodexState = AggregatorState;
// Implementation contract in codex.ts:
// walkCodexSessions(roots: string[]): Promise<CodexEntry[]>
// parseCodexSession(filePath: string, sessionId: string, opts?: CodexParseOptions): Promise<CodexState>
// IDs are `codex:${session_meta.payload.id}`. Preserve original rawJson and physical lineNo.
// Rows use user/assistant/tool-use/tool-result/system types; tools are explicit row types.
// TokenUsage: input excludes cached input; output includes reasoning (do not add twice).
