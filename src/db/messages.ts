import type Database from "better-sqlite3";
import type { MessageRow, SearchHit } from "../types.js";

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

export function searchMessages(
  db: Database.Database,
  query: string,
  opts: { limit?: number } = {}
): SearchHit[] {
  const limit = opts.limit ?? 50;
  // FTS5 snippet(): table, column, before, after, ellipsis, max-tokens
  const rows = db
    .prepare(
      `SELECT m.session_id   AS sessionId,
              m.line_no      AS lineNo,
              snippet(messages_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet,
              bm25(messages_fts) AS rank
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
        WHERE messages_fts MATCH ?
        ORDER BY rank ASC
        LIMIT ?`
    )
    .all(query, limit) as Array<{ sessionId: string; lineNo: number; snippet: string; rank: number }>;
  return rows;
}
