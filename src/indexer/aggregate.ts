import { extractText } from "./extract.js";
import type { MessageRow, RawMessage } from "../types.js";

export type AggregatorState = {
  messages: MessageRow[];
  messageCount: number;
  userMsgCount: number;
  compactCount: number;
  startedAt: number | null;
  lastActivity: number | null;
  firstPrompt: string | null;
  aiTitle: string | null;
  gitBranch: string | null;
  cwd: string | null;
};

export type Aggregator = {
  state: AggregatorState;
  observe(args: { lineNo: number; raw: RawMessage; rawJson: string; sessionId?: string }): void;
};

function parseTimestamp(ts: string | number | undefined): number | null {
  if (ts === undefined) return null;
  if (typeof ts === "number") return ts;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

export function newAggregator(): Aggregator {
  const state: AggregatorState = {
    messages: [], messageCount: 0, userMsgCount: 0, compactCount: 0,
    startedAt: null, lastActivity: null, firstPrompt: null,
    aiTitle: null, gitBranch: null, cwd: null,
  };
  return {
    state,
    observe({ lineNo, raw, rawJson, sessionId }) {
      const ts = parseTimestamp(raw.timestamp);
      const type = raw.type ?? "unknown";
      const role = raw.message?.role ?? null;
      const isSidechain = !!raw.isSidechain;
      const isCompactSummary = !!raw.isCompactSummary;
      const text = extractText(raw);

      state.messageCount += 1;
      if (type === "user" && !isSidechain) state.userMsgCount += 1;
      if (isCompactSummary) state.compactCount += 1;
      if (ts !== null) {
        if (state.startedAt === null || ts < state.startedAt) state.startedAt = ts;
        if (state.lastActivity === null || ts > state.lastActivity) state.lastActivity = ts;
      }
      if (raw.gitBranch && !state.gitBranch) state.gitBranch = raw.gitBranch;
      if (raw.cwd && !state.cwd) state.cwd = raw.cwd;
      if (type === "ai-title" && typeof raw.title === "string") state.aiTitle = raw.title;
      if (state.firstPrompt === null && type === "user" && !isSidechain && text) {
        state.firstPrompt = text.slice(0, 200);
      }

      state.messages.push({
        sessionId: sessionId ?? raw.sessionId ?? "",
        lineNo, uuid: raw.uuid ?? null, parentUuid: raw.parentUuid ?? null,
        type, role, isSidechain, isCompactSummary, timestamp: ts,
        textContent: text, rawJson,
      });
    },
  };
}

export function finalizeAggregator(agg: Aggregator): AggregatorState {
  return agg.state;
}
