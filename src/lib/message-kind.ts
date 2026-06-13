import type { MessageRow } from "../types";

export type MessageKind =
  | "user-text"
  | "assistant-text"
  | "tool-use"
  | "tool-result"
  | "attachment"
  | "compact-summary"
  | "sidechain"
  | "noise";

/**
 * Internal Claude Code message types that aren't part of the visible conversation
 * (metadata, state, snapshots). These are hidden by default behind the
 * "Show system messages" toggle.
 */
const NOISE_TYPES = new Set([
  "last-prompt",
  "permission-mode",
  "queue-operation",
  "file-history-snapshot",
  "ai-title",
  "system",
  "agent-name",
  "pr-link",
]);

// CLI plumbing echoed into the transcript as "user" turns: slash-command
// invocations and local-command caveats/output. Anchored at the start.
const COMMAND_WRAPPER = /^\s*<(command-name|command-message|command-args|local-command-caveat|local-command-stdout|local-command-stderr)>/i;

/**
 * Classify a message by its type + structural shape (parsed once from raw_json).
 * Order matters: compact and sidechain are flagged before content-type classification,
 * and internal/empty messages collapse to "noise" so the conversation stays readable.
 */
export function classifyMessage(m: MessageRow): MessageKind {
  if (m.isCompactSummary) return "compact-summary";
  if (m.isSidechain) return "sidechain";
  if (NOISE_TYPES.has(m.type)) return "noise";

  if (m.type === "attachment") {
    // Attachments with no recoverable filename are noise.
    if (!m.textContent || m.textContent === "[attachment: unknown]") return "noise";
    return "attachment";
  }

  if (m.type === "user" || m.type === "assistant") {
    // Inspect raw_json to detect tool blocks within the user/assistant message.
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
    // Empty user/assistant turns (tool-only or thinking-only) render as empty
    // boxes — collapse them to noise instead.
    if (!m.textContent || !m.textContent.trim()) return "noise";
    // Slash-command echoes and local-command wrappers are CLI plumbing, not
    // conversation — collapse them (anchored at start so mid-text mentions are safe).
    if (COMMAND_WRAPPER.test(m.textContent)) return "noise";
    return m.type === "user" ? "user-text" : "assistant-text";
  }

  // Unknown types → noise rather than an ugly fallback box.
  return "noise";
}

/** Author buckets for role-filtered retrieval (the `get_messages` MCP tool). */
export type MessageAuthor = "user" | "assistant" | "tool" | "agent";

/**
 * Which author a message belongs to, or null if it's noise/meta/attachment.
 * Sub-agent (Task) turns are "agent" regardless of their inner role — that's the
 * category callers mean by "agents". Otherwise we map the visible message kind.
 */
export function authorOf(m: MessageRow): MessageAuthor | null {
  if (m.isSidechain) return "agent";
  switch (classifyMessage(m)) {
    case "user-text":
      return "user";
    case "assistant-text":
      return "assistant";
    case "tool-use":
    case "tool-result":
      return "tool";
    default:
      return null; // noise, attachment, compact-summary
  }
}
