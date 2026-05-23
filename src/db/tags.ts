import type Database from "better-sqlite3";

// Tag validation per spec: trimmed, non-empty, max 64 chars.
function normalize(input: string): string {
  const t = input.trim();
  if (!t) throw new Error("Tag cannot be empty");
  if (t.length > 64) throw new Error("Tag exceeds 64 character limit");
  return t;
}

export function addTag(db: Database.Database, sessionId: string, tag: string, createdAt: number): void {
  const t = normalize(tag);
  db.prepare(
    `INSERT INTO session_tags (session_id, tag, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id, tag) DO NOTHING`
  ).run(sessionId, t, createdAt);
}

export function removeTag(db: Database.Database, sessionId: string, tag: string): void {
  db.prepare("DELETE FROM session_tags WHERE session_id = ? AND tag = ?").run(sessionId, normalize(tag));
}

export function getSessionTags(db: Database.Database, sessionId: string): string[] {
  const rows = db
    .prepare("SELECT tag FROM session_tags WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

export function getSessionsByTag(db: Database.Database, tag: string): string[] {
  const rows = db
    .prepare(
      "SELECT session_id FROM session_tags WHERE LOWER(tag) = LOWER(?) ORDER BY created_at DESC"
    )
    .all(normalize(tag)) as Array<{ session_id: string }>;
  return rows.map((r) => r.session_id);
}
