import { renderMarkdown } from "./markdown.js";
import { classifyMessage } from "./message-kind.js";
import { formatTimestamp } from "./render.js";
import type { MessageRow, Session } from "../types.js";

export type ExportFormat = "md" | "html";

// "Clean" export = the readable conversation only. `raw` adds tool calls/results
// and other non-noise turns. Pure noise (meta/state/empty/command echoes) is never
// exported in either mode.
const CLEAN_KINDS = new Set(["user-text", "assistant-text", "compact-summary", "attachment"]);

export function sessionTitle(session: Session): string {
  return (session.aiTitle || session.firstPrompt || session.id).replace(/\s+/g, " ").trim();
}

/** A safe, descriptive download filename, e.g. `ccaudit-analyze-har-e0af3e48.md`. */
export function exportFilename(session: Session, format: ExportFormat): string {
  const slug =
    sessionTitle(session)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "session";
  return `ccaudit-${slug}-${session.id.slice(0, 8)}.${format}`;
}

function authorLabel(m: MessageRow): string {
  if (m.isSidechain) return "Sub-agent";
  switch (classifyMessage(m)) {
    case "user-text":
      return "User";
    case "assistant-text":
      return "Assistant";
    case "tool-use":
      return "Tool call";
    case "tool-result":
      return "Tool result";
    case "compact-summary":
      return "Compaction summary";
    case "attachment":
      return "Attachment";
    default:
      return m.role ?? m.type;
  }
}

function selectMessages(messages: MessageRow[], raw: boolean): MessageRow[] {
  return messages.filter((m) => {
    const kind = classifyMessage(m);
    if (kind === "noise") return false;
    const hasText = !!(m.textContent && m.textContent.trim());
    if (raw) return hasText;
    return CLEAN_KINDS.has(kind) && hasText;
  });
}

function metaLines(session: Session): string[] {
  const meta = [
    `- **Project:** ${session.projectLabel ?? "unknown"}`,
  ];
  if (session.cwd) meta.push(`- **Directory:** \`${session.cwd}\``);
  if (session.gitBranch) meta.push(`- **Branch:** ${session.gitBranch}`);
  meta.push(`- **Started:** ${formatTimestamp(session.startedAt)}`);
  meta.push(`- **Last activity:** ${formatTimestamp(session.lastActivity)}`);
  meta.push(
    `- **Messages:** ${session.messageCount}` +
      (session.compactCount ? ` · ${session.compactCount} compaction(s)` : "")
  );
  meta.push(`- **Session ID:** \`${session.id}\``);
  return meta;
}

/** GitHub-flavored Markdown transcript. */
export function renderSessionMarkdown(
  session: Session,
  messages: MessageRow[],
  opts: { raw?: boolean } = {}
): string {
  const picked = selectMessages(messages, !!opts.raw);
  const out: string[] = [`# ${sessionTitle(session)}`, "", ...metaLines(session), "", "---", ""];
  for (const m of picked) {
    out.push(`### ${authorLabel(m)}`, "", (m.textContent ?? "").trimEnd(), "");
  }
  out.push("---", "", "<sub>Exported from ccaudit — https://github.com/subhayu99/ccaudit</sub>", "");
  return out.join("\n");
}

const HTML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => HTML_ESCAPE[c]!);

const ROLE_CLASS: Record<string, string> = {
  User: "user",
  Assistant: "assistant",
  "Sub-agent": "agent",
  "Tool call": "tool",
  "Tool result": "tool",
  "Compaction summary": "compact",
  Attachment: "attach",
};

/** Self-contained HTML transcript (warm-obsidian palette; shiki inlines code colors). */
export async function renderSessionHtml(
  session: Session,
  messages: MessageRow[],
  opts: { raw?: boolean } = {}
): Promise<string> {
  const picked = selectMessages(messages, !!opts.raw);
  const blocks: string[] = [];
  for (const m of picked) {
    const label = authorLabel(m);
    const cls = ROLE_CLASS[label] ?? "other";
    const body = await renderMarkdown(m.textContent ?? "");
    blocks.push(
      `<section class="msg ${cls}"><div class="role">${esc(label)}</div><div class="body">${body}</div></section>`
    );
  }
  const meta = metaLines(session)
    .map((l) => `<li>${esc(l.replace(/^- /, "").replace(/\*\*/g, "").replace(/`/g, ""))}</li>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(sessionTitle(session))} · ccaudit</title>
<style>
  :root { --bg:#1a1613; --panel:#221d19; --panel-2:#2a2420; --border:rgba(255,247,237,.10);
    --text:#f3ece1; --dim:#c9bba9; --faint:#8a7d6e; --amber:#d2a85f; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:820px; margin:0 auto; padding:40px 22px 80px; }
  h1 { font-size:24px; font-weight:600; margin:0 0 14px; }
  .meta { list-style:none; padding:14px 16px; margin:0 0 26px; background:var(--panel);
    border:1px solid var(--border); border-radius:12px; color:var(--dim); font-size:13px; }
  .meta li { margin:2px 0; }
  .msg { background:var(--panel); border:1px solid var(--border); border-radius:12px;
    padding:14px 16px; margin:12px 0; border-left:3px solid var(--faint); }
  .msg.user { border-left-color:var(--amber); }
  .msg.assistant { border-left-color:#7fae7a; }
  .msg.agent { border-left-color:#a98fd0; }
  .msg.tool { border-left-color:#6b9bd1; opacity:.92; }
  .msg.compact { border-left-color:var(--faint); font-style:italic; }
  .role { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--faint);
    margin-bottom:8px; font-weight:600; }
  .body > *:first-child { margin-top:0; } .body > *:last-child { margin-bottom:0; }
  .body :where(pre) { border-radius:10px; padding:12px 14px; overflow:auto; font-size:13px; }
  .body :where(code):not(pre code) { background:var(--panel-2); border:1px solid var(--border);
    border-radius:5px; padding:1px 5px; font-size:.9em; }
  .body :where(table) { border-collapse:collapse; } .body :where(th,td) { border:1px solid var(--border); padding:5px 9px; }
  .body :where(a) { color:var(--amber); }
  footer { margin-top:30px; color:var(--faint); font-size:12px; text-align:center; }
  footer a { color:var(--faint); }
</style></head>
<body><div class="wrap">
<h1>${esc(sessionTitle(session))}</h1>
<ul class="meta">${meta}</ul>
${blocks.join("\n")}
<footer>Exported from <a href="https://github.com/subhayu99/ccaudit">ccaudit</a></footer>
</div></body></html>`;
}
