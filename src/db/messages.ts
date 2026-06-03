import type { Db } from "./init.js";
import type { MessageRow, SearchHit } from "../types.js";
import { sessionKeepCondition } from "./exclusions.js";
import { rangeCondition, type DateRange } from "./date-range.js";

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

export function insertMessages(db: Db, rows: MessageRow[]): void {
  // OR IGNORE: in append-mode re-indexing we hand the full parsed message set but only the
  // new line_nos are absent (PK is session_id+line_no), so existing rows are kept and their
  // FTS entries are not re-tokenized. In full-mode the session's rows were just deleted, so
  // nothing is ignored. Claude Code session logs are append-only, so a given line_no's content
  // is immutable — keeping the existing row is correct.
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO messages
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

export function deleteSessionMessages(db: Db, sessionId: string): void {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
}

export function getSessionMessages(db: Db, sessionId: string): MessageRow[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY line_no ASC")
    .all(sessionId) as MessageRowSql[];
  return rows.map(rowToMessage);
}

/** The last `limit` messages (chronological). Avoids loading 17k rows to show a few hundred. */
export function getSessionMessagesTail(
  db: Db,
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
  db: Db,
  sessionId: string,
  limit: number
): MessageRow[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY line_no ASC LIMIT ?")
    .all(sessionId, limit) as MessageRowSql[];
  return rows.map(rowToMessage);
}

/** Quote each whitespace term (doubling internal quotes) so operators/punctuation in arbitrary
 *  user input are treated literally by FTS5 MATCH. */
function ftsTerms(query: string): string[] {
  return query.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"`);
}

/** Default (AND): every term must appear — precise search. */
export function escapeFtsQuery(query: string): string {
  return ftsTerms(query).join(" ");
}

/** OR: match any term — recall-oriented retrieval (RAG), ranked by bm25. */
export function escapeFtsQueryAny(query: string): string {
  return ftsTerms(query).join(" OR ");
}

export function searchMessages(
  db: Db,
  query: string,
  opts: { limit?: number; match?: "all" | "any"; types?: string[]; range?: DateRange | null } = {}
): SearchHit[] {
  const limit = opts.limit ?? 50;
  const ftsQuery = opts.match === "any" ? escapeFtsQueryAny(query) : escapeFtsQuery(query);
  if (!ftsQuery) return [];
  const excl = sessionKeepCondition(db);
  // When no exclusions are set, omit the session-id subquery entirely: it would
  // otherwise force a per-row scan of the full sessions id-set for nothing.
  const exclClause =
    excl.sql === "1" ? "" : `AND m.session_id IN (SELECT id FROM sessions WHERE ${excl.sql})`;
  // Global date-range filter (same shape): restrict to sessions whose activity is in-window.
  const rg = rangeCondition(opts.range ?? null, "last_activity");
  const rangeClause =
    rg.sql === "1" ? "" : `AND m.session_id IN (SELECT id FROM sessions WHERE ${rg.sql})`;
  // Optional message-type restriction (types are code-controlled, safe to inline).
  const typeClause =
    opts.types && opts.types.length
      ? `AND m.type IN (${opts.types.map((t) => `'${t}'`).join(",")})`
      : "";
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
          ${rangeClause}
          ${typeClause}
        ORDER BY rank ASC
        LIMIT @limit`
    )
    .all({ q: ftsQuery, limit, ...excl.params, ...rg.params }) as Array<{
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

/**
 * Session ids whose AI title, first prompt, or id contains `query` — so search can surface a session
 * that matches by title/ID even when no message content matched. Respects exclusions + date range.
 */
export function searchSessionIdsByTitle(
  db: Db,
  query: string,
  opts: { limit?: number; range?: DateRange | null } = {}
): string[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const excl = sessionKeepCondition(db);
  const rg = rangeCondition(opts.range ?? null, "last_activity");
  const rows = db
    .prepare(
      `SELECT id FROM sessions
        WHERE (instr(lower(COALESCE(ai_title, '')), lower(@q)) > 0
            OR instr(lower(COALESCE(first_prompt, '')), lower(@q)) > 0
            OR instr(lower(id), lower(@q)) > 0)
          AND ${excl.sql} AND ${rg.sql}
        ORDER BY last_activity DESC
        LIMIT @limit`
    )
    .all({ q, limit: opts.limit ?? 40, ...excl.params, ...rg.params }) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function searchMessagesExact(
  db: Db,
  query: string,
  opts: { limit?: number; range?: DateRange | null } = {}
): SearchHit[] {
  const limit = opts.limit ?? 50;
  const excl = sessionKeepCondition(db);
  const exclClause =
    excl.sql === "1" ? "" : `AND session_id IN (SELECT id FROM sessions WHERE ${excl.sql})`;
  const rg = rangeCondition(opts.range ?? null, "last_activity");
  const rangeClause =
    rg.sql === "1" ? "" : `AND session_id IN (SELECT id FROM sessions WHERE ${rg.sql})`;
  const rows = db
    .prepare(
      `SELECT session_id AS sessionId,
              line_no    AS lineNo,
              text_content AS text
         FROM messages
        WHERE text_content LIKE '%' || @q || '%' COLLATE NOCASE
          ${exclClause}
          ${rangeClause}
        ORDER BY session_id, line_no
        LIMIT @limit`
    )
    .all({ q: query, limit, ...excl.params, ...rg.params }) as Array<{
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
  db: Db,
  pattern: string,
  opts: { limit?: number; range?: DateRange | null } = {}
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
  const rg = rangeCondition(opts.range ?? null, "last_activity");
  const rangeClause =
    rg.sql === "1" ? "" : `AND session_id IN (SELECT id FROM sessions WHERE ${rg.sql})`;
  const rows = db
    .prepare(
      `SELECT session_id   AS sessionId,
              line_no      AS lineNo,
              text_content AS text
         FROM messages
        WHERE text_content IS NOT NULL
          AND ccaudit_regexp(@pat, text_content) = 1
          ${exclClause}
          ${rangeClause}
        ORDER BY session_id, line_no
        LIMIT @limit`
    )
    .all({ pat: pattern, limit, ...excl.params, ...rg.params }) as Array<{
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
