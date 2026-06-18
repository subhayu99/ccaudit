import type { TokenUsage } from "./lib/pricing.js";

// Session row mirrored from SQLite. `null` where the source value was missing.
export type Session = {
  id: string;
  projectDir: string;
  projectLabel: string;
  filePath: string;
  fileMtime: number;
  fileSize: number;
  startedAt: number | null;
  lastActivity: number | null;
  gitBranch: string | null;
  messageCount: number;
  userMsgCount: number;
  compactCount: number;
  firstPrompt: string | null;
  aiTitle: string | null;
  cwd: string | null;
  indexedAt: number;
  /** Per-model token totals (assistant `message.usage`). null/absent if not yet captured. */
  tokenUsage?: TokenUsage | null;
  /**
   * Work-dir inference (precomputed at index time, see lib/session-dirs.ts).
   * `inferredDir` is the project root where the work actually happened when it
   * differs from where the session is filed (a misfiled session); null when the
   * session is filed correctly. The hit counts are the supporting evidence.
   * Optional like `tokenUsage` — index-derived, persisted with DB defaults, so a
   * producer may omit them (the upsert defaults to null/0).
   */
  inferredDir?: string | null;
  inferredHits?: number;
  inferredLaunchHits?: number;
};

export type MessageRow = {
  sessionId: string;
  lineNo: number;
  uuid: string | null;
  parentUuid: string | null;
  type: string;
  role: string | null;
  isSidechain: boolean;
  isCompactSummary: boolean;
  timestamp: number | null;
  textContent: string | null;
  rawJson: string;
};

export type SearchHit = {
  sessionId: string;
  lineNo: number;
  snippet: string;
  rank: number;
};

// Raw JSONL message — a loose subset; unknown fields are preserved via raw_json.
export type RawMessage = {
  type: string;
  uuid?: string;
  parentUuid?: string;
  sessionId?: string;
  // ISO 8601 string ("2026-05-23T10:00:00Z") or ms epoch. Indexer normalises to ms.
  timestamp?: string | number;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  cwd?: string;
  gitBranch?: string;
  message?: {
    role?: string;
    content?: unknown; // string | Array<{type, text?, ...}>
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  // ai-title messages carry the title in `aiTitle`; user-set titles in `customTitle`.
  // (`title` kept for backward-compat with any older log shape.)
  title?: string;
  aiTitle?: string;
  customTitle?: string;
};
