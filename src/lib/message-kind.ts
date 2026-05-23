import type { MessageRow } from "../types";

export type MessageKind =
  | "user-text"
  | "assistant-text"
  | "tool-use"
  | "tool-result"
  | "attachment"
  | "compact-summary"
  | "sidechain"
  | "other";

/**
 * Classify a message based on its type + structural shape (parsed once from raw_json).
 * Order matters: compact and sidechain are flagged before content-type classification.
 */
export function classifyMessage(m: MessageRow): MessageKind {
  if (m.isCompactSummary) return "compact-summary";
  if (m.isSidechain) return "sidechain";
  if (m.type === "attachment") return "attachment";
  if (m.type === "user" || m.type === "assistant") {
    // Inspect raw_json to detect tool blocks within the user/assistant message
    try {
      const raw = JSON.parse(m.rawJson);
      const content = raw?.message?.content;
      if (Array.isArray(content)) {
        const hasToolUse = content.some((p: { type?: string }) => p?.type === "tool_use");
        const hasToolResult = content.some((p: { type?: string }) => p?.type === "tool_result");
        if (hasToolUse) return "tool-use";
        if (hasToolResult) return "tool-result";
      }
    } catch {
      // fall through
    }
    return m.type === "user" ? "user-text" : "assistant-text";
  }
  return "other";
}
