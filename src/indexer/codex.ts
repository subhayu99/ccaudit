import { createReadStream } from "node:fs";
import { readdir, lstat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { parseJsonlFile } from "./parse.js";
import { projectLabel } from "../paths.js";
import { emptyModelUsage } from "../lib/pricing.js";
import type { MessageRow } from "../types.js";
import type { CodexEntry, CodexParseOptions, CodexState } from "./codex-types.js";

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Obj : {};
const str = (x: unknown): string | null => typeof x === "string" && x.length > 0 ? x : null;
const ms = (x: unknown): number | null => {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x !== "string") return null;
  const n = Date.parse(x); return Number.isFinite(n) ? n : null;
};
const number = (x: unknown): number => typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0;

async function metadata(filePath: string): Promise<Obj | null> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let linesSeen = 0, bytesSeen = 0;
  try {
    for await (const line of reader) {
      linesSeen++;
      bytesSeen += Buffer.byteLength(line, "utf8") + 1;
      if (linesSeen > 64 || bytesSeen > 256 * 1024) return null;
      let raw: Obj;
      try { raw = obj(JSON.parse(line)); } catch { continue; }
      if (raw.type !== "session_meta") continue;
      const payload = obj(raw.payload);
      return str(payload.id) ? payload : null;
    }
  } catch { return null; }
  finally { reader.close(); stream.destroy(); }
  return null;
}

/** Discover native Codex logs in root order. Roots may be sessions or archived_sessions. */
export async function walkCodexSessions(roots: string[]): Promise<CodexEntry[]> {
  const found: CodexEntry[] = [];
  const seen = new Set<string>();
  async function visit(path: string): Promise<void> {
    let stat;
    try { stat = await lstat(path); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      let names: string[];
      try { names = await readdir(path); } catch { return; }
      for (const name of names.sort()) await visit(join(path, name));
      return;
    }
    if (!stat.isFile() || !path.endsWith(".jsonl")) return;
    const meta = await metadata(path);
    const nativeId = str(meta?.id), cwd = str(meta?.cwd);
    if (!nativeId || !cwd) return;
    const sessionId = `codex:${nativeId}`;
    if (seen.has(sessionId)) return;
    seen.add(sessionId);
    found.push({ provider: "codex", sessionId, projectDir: cwd, projectLabel: projectLabel(cwd),
      filePath: path, fileMtime: Math.floor(stat.mtimeMs), fileSize: stat.size });
  }
  for (const root of roots) await visit(root);
  return found;
}

function contentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content.map(item => {
    const p = obj(item);
    if (p.type === "input_image" || p.type === "output_image" || p.image_url !== undefined) return "[image attachment]";
    return ["input_text", "output_text", "text"].includes(String(p.type)) ? str(p.text) : null;
  }).filter((x): x is string => x !== null);
  return parts.length ? parts.join("\n") : null;
}
function readable(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value == null) return null;
  try { return JSON.stringify(value); } catch { return null; }
}
function toolResultText(value: unknown): string | null {
  function render(item: unknown): string | null {
    if (typeof item === "string") return item;
    if (Array.isArray(item)) {
      const parts = item.map(render).filter((part): part is string => part !== null);
      return parts.length ? parts.join("\n") : null;
    }
    if (item === null || typeof item !== "object") return readable(item);
    const part = obj(item);
    const type = str(part.type);
    if (type?.includes("image") || part.image_url !== undefined) return "[image]";
    if ((type === "text" || type === "input_text" || type === "output_text") && typeof part.text === "string") return part.text;
    if (part.content !== undefined) return render(part.content);
    if (part.output !== undefined) return render(part.output);
    const clean = JSON.stringify(part, (key, nested) => {
      if (key === "image_url") return "[image]";
      if (key && str(obj(nested).type)?.includes("image")) return "[image]";
      return nested;
    });
    return clean || null;
  }
  return render(value)?.slice(0, 2000) ?? null;
}
function isInjectedSetup(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("# AGENTS.md instructions") || trimmed.startsWith("<environment_context>");
}
function usage(raw: unknown) {
  const p = obj(raw);
  return { input: number(p.input_tokens), cached: number(p.cached_input_tokens),
    cacheWrite: number(p.cache_write_input_tokens), output: number(p.output_tokens) };
}
type Usage = ReturnType<typeof usage>;
function addUsage(state: CodexState, model: string, current: Usage, prior?: Usage) {
  const u = state.tokenUsage[model] ??= emptyModelUsage();
  const reset = !!prior && (current.input < prior.input || current.cached < prior.cached ||
    current.output < prior.output || current.cacheWrite < prior.cacheWrite);
  const delta = reset || !prior ? current : {
    input: current.input - prior.input, cached: current.cached - prior.cached,
    output: current.output - prior.output, cacheWrite: current.cacheWrite - prior.cacheWrite,
  };
  u.input += Math.max(0, delta.input - delta.cached - delta.cacheWrite);
  u.cacheRead += delta.cached;
  u.cacheCreation += delta.cacheWrite;
  u.output += delta.output;
}

/** Parse one Codex session into the existing indexer's aggregate contract. */
export async function parseCodexSession(filePath: string, sessionId: string, opts: CodexParseOptions = {}): Promise<CodexState> {
  const state: CodexState = { messages: [], messageCount: 0, userMsgCount: 0, compactCount: 0,
    startedAt: null, lastActivity: null, firstPrompt: null, aiTitle: null, customTitle: null,
    gitBranch: null, cwd: null, isInternal: false, tokenUsage: {} };
  const eventRows: MessageRow[] = [];
  const responseCounts = new Map<string, number>();
  let cumulativeTotal: Usage | undefined;
  let hasCumulative = false;
  const lastFallback = new Map<string, { usage: Usage; identity: string | null }>();
  const fallbackTotals = new Map<string, Usage>();
  let currentModel = "codex-unknown";
  function trackTime(timestamp: number | null) {
    if (timestamp === null) return;
    state.startedAt = state.startedAt === null ? timestamp : Math.min(state.startedAt, timestamp);
    state.lastActivity = state.lastActivity === null ? timestamp : Math.max(state.lastActivity, timestamp);
  }
  function row(lineNo: number, rawJson: string, timestamp: number | null, type: string, role: string | null, textContent: string | null, compact = false): MessageRow {
    return { sessionId, lineNo, uuid: null, parentUuid: null, type, role, isSidechain: false,
      isCompactSummary: compact, timestamp, textContent, rawJson };
  }
  for await (const { lineNo, raw: source, rawJson } of parseJsonlFile(filePath, opts)) {
    const raw = obj(source), payload = obj(raw.payload), timestamp = ms(raw.timestamp);
    trackTime(timestamp);
    if (raw.type === "session_meta" || raw.type === "turn_context") {
      state.cwd ??= str(payload.cwd);
      state.gitBranch ??= str(obj(payload.git).branch);
      const model = str(payload.model); if (model) currentModel = model;
      continue;
    }
    if (raw.type === "compacted") {
      const textContent = str(payload.message) ?? str(payload.summary) ?? contentText(payload.content);
      state.messages.push(row(lineNo, rawJson, timestamp, "system", "system", textContent, true));
      continue;
    }
    if (raw.type === "response_item") {
      const kind = payload.type;
      let type: string | null = null, role: string | null = null, textContent: string | null = null;
      if (kind === "message") {
        role = str(payload.role);
        if (role === "user" || role === "assistant" || role === "system") {
          type = role; textContent = contentText(payload.content);
          if (type === "user" && textContent && isInjectedSetup(textContent)) { type = "system"; role = "system"; }
        }
      } else if (kind === "function_call" || kind === "custom_tool_call") {
        type = "tool-use"; role = "assistant";
        textContent = [str(payload.name), readable(payload.arguments ?? payload.input)].filter(Boolean).join(" ") || null;
      } else if (kind === "function_call_output" || kind === "custom_tool_call_output") {
        type = "tool-result"; role = "tool"; textContent = toolResultText(payload.output);
      }
      if (type && textContent) {
        state.messages.push(row(lineNo, rawJson, timestamp, type, role, textContent));
        if (type === "user" || type === "assistant" || (type === "system" && isInjectedSetup(textContent))) {
          const key = `${type}\0${textContent}`;
          responseCounts.set(key, (responseCounts.get(key) ?? 0) + 1);
        }
      }
      continue;
    }
    if (raw.type !== "event_msg") continue;
    const kind = payload.type;
    if (kind === "token_count") {
      const info = obj(payload.info), model = str(info.model) ?? currentModel;
      if (info.total_token_usage && Object.keys(obj(info.total_token_usage)).length) {
        const total = usage(info.total_token_usage);
        addUsage(state, model, total, cumulativeTotal);
        cumulativeTotal = total;
        hasCumulative = true;
      } else if (!hasCumulative && info.last_token_usage) {
        const last = usage(info.last_token_usage);
        const prior = lastFallback.get(model);
        const identity = str(raw.id) ?? str(payload.id) ?? (timestamp === null ? null : String(timestamp));
        if (!prior || !identity || prior.identity !== identity || JSON.stringify(last) !== JSON.stringify(prior.usage)) {
          const sum = fallbackTotals.get(model) ?? { input: 0, cached: 0, output: 0, cacheWrite: 0 };
          sum.input += last.input; sum.cached += last.cached;
          sum.output += last.output; sum.cacheWrite += last.cacheWrite;
          fallbackTotals.set(model, sum);
        }
        lastFallback.set(model, { usage: last, identity });
      }
    } else if (kind === "user_message" || kind === "agent_message") {
      const type = kind === "user_message" ? "user" : "assistant";
      const textContent = str(payload.message) ?? contentText(payload.content);
      if (textContent) {
        const mapped = type === "user" && isInjectedSetup(textContent) ? "system" : type;
        eventRows.push(row(lineNo, rawJson, timestamp, mapped, mapped, textContent));
      }
    } else if (kind === "compacted") {
      const textContent = str(payload.message) ?? str(payload.summary) ?? contentText(payload.content);
      if (textContent) state.messages.push(row(lineNo, rawJson, timestamp, "system", "system", textContent, true));
    }
  }
  if (!hasCumulative) for (const [model, total] of fallbackTotals) addUsage(state, model, total);
  for (const event of eventRows) {
    const key = `${event.type}\0${event.textContent}`;
    const count = responseCounts.get(key) ?? 0;
    if (count > 0) { responseCounts.set(key, count - 1); continue; }
    state.messages.push(event);
  }
  state.messages.sort((a, b) => a.lineNo - b.lineNo);
  state.messageCount = state.messages.length;
  state.userMsgCount = state.messages.filter(x => x.type === "user").length;
  state.compactCount = state.messages.filter(x => x.isCompactSummary).length;
  state.firstPrompt = state.messages.find(x => x.type === "user" && x.textContent)?.textContent?.slice(0, 200) ?? null;
  return state;
}
