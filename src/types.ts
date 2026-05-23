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
  indexedAt: number;
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
  timestamp?: string | number;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  cwd?: string;
  gitBranch?: string;
  message?: {
    role?: string;
    content?: unknown; // string | Array<{type, text?, ...}>
  };
  // ai-title messages
  title?: string;
};
