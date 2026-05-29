import type { RawMessage } from "../types.js";
import { cleanPromptText } from "../lib/clean-prompt.js";

const MAX_TOOL_RESULT_CHARS = 2000;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; name?: string; input?: unknown }
  | { type: "tool_result"; content?: ContentPart[] | string }
  | { type: "image" | string; [k: string]: unknown };

function isPartArray(value: unknown): value is ContentPart[] {
  return Array.isArray(value);
}

function extractFromParts(parts: ContentPart[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === "text" && typeof (p as { text?: unknown }).text === "string") {
      out.push((p as { text: string }).text);
    } else if (p.type === "tool_result") {
      const c = (p as { content?: ContentPart[] | string }).content;
      let text = "";
      if (typeof c === "string") text = c;
      else if (isPartArray(c)) text = extractFromParts(c);
      if (text) out.push(text.slice(0, MAX_TOOL_RESULT_CHARS));
    }
    // tool_use: intentionally skipped
  }
  return out.join("\n\n").trim();
}

export function extractText(raw: RawMessage): string | null {
  const t = raw.type;
  if (t === "attachment") {
    const filename =
      (raw as { attachment?: { filename?: string } }).attachment?.filename ?? "unknown";
    return `[attachment: ${filename}]`;
  }
  if (t === "ai-title") {
    return typeof raw.title === "string" ? raw.title : null;
  }
  const content = raw.message?.content;
  let text: string | null = null;
  if (typeof content === "string") text = content.trim() || null;
  else if (isPartArray(content)) text = extractFromParts(content as ContentPart[]) || null;

  // User messages from Conductor are prefixed with injected instruction blocks
  // that bury the real ask; strip them so titles/timeline/search stay clean.
  if (text && t === "user") {
    text = cleanPromptText(text) || null;
  }
  return text;
}
