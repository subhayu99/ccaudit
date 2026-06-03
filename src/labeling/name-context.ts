import type { Db } from "../db/init.js";
import { getSessionMessagesHead } from "../db/messages.js";
import { segmentSession } from "../lib/segment.js";
import { cleanPromptText } from "../lib/clean-prompt.js";

/**
 * Opening context for AI titling: the first few cleaned user-turn segment openers (best signal),
 * falling back to the cleaned first prompt. Shared by the `ccaudit name` CLI and the /api/name route.
 */
export function buildNameContext(db: Db, id: string, firstPrompt: string | null): string {
  try {
    const head = getSessionMessagesHead(db, id, 300);
    const openers = segmentSession(head).map((s) => s.opener).filter(Boolean).slice(0, 4);
    const ctx = openers.join("\n").trim();
    if (ctx) return ctx.slice(0, 1400);
  } catch {
    /* fall through to first_prompt */
  }
  return firstPrompt ? cleanPromptText(firstPrompt).slice(0, 700) : "";
}
