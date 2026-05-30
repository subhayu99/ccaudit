import type Database from "better-sqlite3";
import type { MessageRow, SearchHit } from "../types.js";
import { sessionKeepCondition } from "./exclusions.js";

type MessageRowSql = {
  session_id: string;
  line_no: number;
  uuid: string | null;
  parent_uuid: string | null;
  type: string;
  role: string | null;
  is_sidechain: number;
  is_compact_summary: number;
  timestamp: number | null;
  text_content: string | null;
  raw_json: string;
};

function rowToMessage(r: MessageRowSql): MessageRow {
  return {
    sessionId: r.session_id,
    lineNo: r.line_no,
    uuid: r.uuid,
    parentUuid: r.parent_uuid,
    type: r.type,
    role: r.role,
    isSidechain: r.is_sidechain === 1,
    isCompactSummary: r.is_compact_summary === 1,
    timestamp: r.timestamp,
    textContent: r.text_content,
    rawJson: r.raw_json,
  };
}

export function insertMessages(db: Database.Database, rows: MessageRow[]): void {
  const stmt = db.prepare(
    `INSERT INTO messages
       (session_id, line_no, uuid, parent_uuid, type, role,
        is_sidechain, is_compact_summary, timestamp, text_content, raw_json)
     VALUES
       (@sessionId, @lineNo, @uuid, @parentUuid, @type, @role,
        @isSidechain, @isCompactSummary, @timestamp, @textContent, @rawJson)`
  );
  const tx = db.transaction((batch: MessageRow[]) => {
    for (const r of batch) {
      stmt.run({
        sessionId: r.sessionId,
        lineNo: r.lineNo,
        uuid: r.uuid,
        parentUuid: r.parentUuid,
        type: r.type,
        role: r.role,
        isSidechain: r.isSidechain ? 1 : 0,
        isCompactSummary: r.isCompactSummary ? 1 : 0,
        timestamp: r.timestamp,
        textContent: r.textContent,
        rawJson: r.rawJson,
      });
    }
  });
  tx(rows);
}

export function deleteSessionMessages(db: Database.Database, sessionId: string): void {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
}

export function getSessionMessages(db: Database.Database, sessionId: string): MessageRow[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY line_no ASC")
    .all(sessionId) as MessageRowSql[];
  return rows.map(rowToMessage);
}

/** The last `limit` messages (chronological). Avoids loading 17k rows to show a few hundred. */
export function getSessionMessagesTail(
  db: Database.Database,
  sessionId: string,
  limit: number
): MessageRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM messages WHERE session_id = ? ORDER BY line_no DESC LIMIT ?
       ) ORDER BY line_no ASC`
    )
    .all(sessionId, limit) as MessageRowSql[];
  return rows.map(rowToMessage);
}

/** The first `limit` messages (chronological) — for building opening context (e.g. titling). */
export function getSessionMessagesHead(
  db: Database.Database,
  sessionId: string,
  limit: number
): MessageRow[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY line_no ASC LIMIT ?")
    .all(sessionId, limit) as MessageRowSql[];
  return rows.map(rowToMessage);
}

/** Make arbitrary user input safe for an FTS5 MATCH: quote each whitespace term
 *  (doubling internal quotes) so operators/punctuation are treated literally. */
export function escapeFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
}

export function searchMessages(
  db: Database.Database,
  query: string,
  opts: { limit?: number } = {}
): SearchHit[] {
  const limit = opts.limit ?? 50;
  const ftsQuery = escapeFtsQuery(query);
  if (!ftsQuery) return [];
  const excl = sessionKeepCondition(db);
  // When no exclusions are set, omit the session-id subquery entirely: it would
  // otherwise force a per-row scan of the full sessions id-set for nothing.
  const exclClause =
    excl.sql === "1" ? "" : `AND m.session_id IN (SELECT id FROM sessions WHERE ${excl.sql})`;
  // FTS5 snippet(): table, column, before, after, ellipsis, max-tokens
  const rows = db
    .prepare(
      `SELECT m.session_id   AS sessionId,
              m.line_no      AS lineNo,
              snippet(messages_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet,
              bm25(messages_fts) AS rank
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
        WHERE messages_fts MATCH @q
          ${exclClause}
        ORDER BY rank ASC
        LIMIT @limit`
    )
    .all({ q: query, limit, ...excl.params }) as Array<{
    sessionId: string;
    lineNo: number;
    snippet: string;
    rank: number;
  }>;
  return rows;
}

function highlightExact(text: string, query: string): string {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
}

function contextSnippet(text: string, query: string, contextChars = 80): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, contextChars * 2);
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);
  const slice = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  return highlightExact(slice, query);
}

export function searchMessagesExact(
  db: Database.Database,
  query: string,
  opts: { limit?: number } = {}
): SearchHit[] {
  const limit = opts.limit ?? 50;
  const excl = sessionKeepCondition(db);
  const exclClause =
    excl.sql === "1" ? "" : `AND session_id IN (SELECT id FROM sessions WHERE ${excl.sql})`;
  const rows = db
    .prepare(
      `SELECT session_id AS sessionId,
              line_no    AS lineNo,
              text_content AS text
         FROM messages
        WHERE text_content LIKE '%' || @q || '%' COLLATE NOCASE
          ${exclClause}
        ORDER BY session_id, line_no
        LIMIT @limit`
    )
    .all({ q: query, limit, ...excl.params }) as Array<{
    sessionId: string;
    lineNo: number;
    text: string;
  }>;
  return rows.map((r) => ({
    sessionId: r.sessionId,
    lineNo: r.lineNo,
    snippet: contextSnippet(r.text, query),
    rank: 0,
  }));
}

export function searchMessagesRegex(
  db: Database.Database,
  pattern: string,
  opts: { limit?: number } = {}
): SearchHit[] {
  const limit = opts.limit ?? 50;
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    return [];
  }
  // ccaudit_regexp UDF is registered once per connection in openDb (src/db/init.ts).
  const excl = sessionKeepCondition(db);
  const exclClause =
    excl.sql === "1" ? "" : `AND session_id IN (SELECT id FROM sessions WHERE ${excl.sql})`;
  const rows = db
    .prepare(
      `SELECT session_id   AS sessionId,
              line_no      AS lineNo,
              text_content AS text
         FROM messages
        WHERE text_content IS NOT NULL
          AND ccaudit_regexp(@pat, text_content) = 1
          ${exclClause}
        ORDER BY session_id, line_no
        LIMIT @limit`
    )
    .all({ pat: pattern, limit, ...excl.params }) as Array<{
    sessionId: string;
    lineNo: number;
    text: string;
  }>;
  return rows.map((r) => {
    const match = r.text.match(re);
    const snippet = match
      ? contextSnippet(r.text, match[0])
      : r.text.slice(0, 160);
    return { sessionId: r.sessionId, lineNo: r.lineNo, snippet, rank: 0 };
  });
}
