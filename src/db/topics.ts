import type { Db } from "./init.js";
import type { TopicCluster } from "../labeling/cluster-topics.js";
import { rangeCondition, type DateRange } from "./date-range.js";

export type TopicSummary = { id: number; name: string; sessionCount: number };

/** Replace all topics with a freshly clustered set (atomic). */
export function replaceTopics(db: Db, clusters: TopicCluster[]): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM topic_members").run();
    db.prepare("DELETE FROM topics").run();
    const insT = db.prepare("INSERT INTO topics (name, created_at) VALUES (?, ?)");
    const insM = db.prepare("INSERT OR IGNORE INTO topic_members (topic_id, session_id) VALUES (?, ?)");
    const now = Date.now();
    for (const c of clusters) {
      const id = insT.run(c.name, now).lastInsertRowid as number;
      for (const sid of c.sessionIds) insM.run(id, sid);
    }
  });
  tx();
}

export function listTopics(db: Db, range: DateRange | null = null): TopicSummary[] {
  const rg = rangeCondition(range, "s.last_activity");
  if (rg.sql === "1") {
    return db
      .prepare(
        `SELECT t.id, t.name, COUNT(m.session_id) AS sessionCount
           FROM topics t LEFT JOIN topic_members m ON m.topic_id = t.id
          GROUP BY t.id, t.name
          ORDER BY sessionCount DESC, t.name ASC`
      )
      .all() as TopicSummary[];
  }
  // Range-scoped: count only members whose session falls in the window.
  return db
    .prepare(
      `SELECT t.id, t.name, COUNT(s.id) AS sessionCount
         FROM topics t
         LEFT JOIN topic_members m ON m.topic_id = t.id
         LEFT JOIN sessions s ON s.id = m.session_id AND ${rg.sql}
        GROUP BY t.id, t.name
        ORDER BY sessionCount DESC, t.name ASC`
    )
    .all(rg.params) as TopicSummary[];
}

/** Session ids already assigned to some topic. */
export function getClusteredSessionIds(db: Db): Set<string> {
  const rows = db.prepare("SELECT DISTINCT session_id AS s FROM topic_members").all() as Array<{ s: string }>;
  return new Set(rows.map((r) => r.s));
}

/** Incrementally merge clusters into the existing set: match a topic by name
 *  (case-insensitive) or create it, then insert members. Never wipes. */
export function addToTopics(db: Db, clusters: TopicCluster[]): void {
  const tx = db.transaction(() => {
    const findT = db.prepare("SELECT id FROM topics WHERE name = ? COLLATE NOCASE");
    const insT = db.prepare("INSERT INTO topics (name, created_at) VALUES (?, ?)");
    const insM = db.prepare("INSERT OR IGNORE INTO topic_members (topic_id, session_id) VALUES (?, ?)");
    const now = Date.now();
    for (const c of clusters) {
      const existing = findT.get(c.name) as { id: number } | undefined;
      const id = existing ? existing.id : (insT.run(c.name, now).lastInsertRowid as number);
      for (const sid of c.sessionIds) insM.run(id, sid);
    }
  });
  tx();
}

/** Rename a topic. Returns false on empty name or a case-insensitive clash with another topic. */
export function renameTopic(db: Db, id: number, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const clash = db
    .prepare("SELECT id FROM topics WHERE name = ? COLLATE NOCASE AND id <> ?")
    .get(trimmed, id) as { id: number } | undefined;
  if (clash) return false;
  return db.prepare("UPDATE topics SET name = ? WHERE id = ?").run(trimmed, id).changes > 0;
}

/** Delete a topic and its membership rows (its sessions become "unclustered" again). */
export function deleteTopic(db: Db, id: number): void {
  db.transaction(() => {
    db.prepare("DELETE FROM topic_members WHERE topic_id = ?").run(id);
    db.prepare("DELETE FROM topics WHERE id = ?").run(id);
  })();
}

/** Merge `sourceIds` into `intoId`: re-point members (dedup), then drop the emptied source topics. */
export function mergeTopics(db: Db, sourceIds: number[], intoId: number): void {
  const sources = sourceIds.filter((s) => s !== intoId);
  if (sources.length === 0) return;
  db.transaction(() => {
    const move = db.prepare(
      "INSERT OR IGNORE INTO topic_members (topic_id, session_id) SELECT ?, session_id FROM topic_members WHERE topic_id = ?"
    );
    for (const s of sources) {
      move.run(intoId, s);
      db.prepare("DELETE FROM topic_members WHERE topic_id = ?").run(s);
      db.prepare("DELETE FROM topics WHERE id = ?").run(s);
    }
  })();
}

/** Another topic (≠ exceptId) with the given name (case-insensitive), if any. */
export function findTopicByName(db: Db, name: string, exceptId?: number): TopicSummary | null {
  const row = db
    .prepare("SELECT id FROM topics WHERE name = ? COLLATE NOCASE AND id <> ?")
    .get(name.trim(), exceptId ?? -1) as { id: number } | undefined;
  if (!row) return null;
  return listTopics(db).find((t) => t.id === row.id) ?? null;
}

export function getTopic(db: Db, topicId: number): { name: string; sessionIds: string[] } | null {
  const t = db.prepare("SELECT name FROM topics WHERE id = ?").get(topicId) as { name: string } | undefined;
  if (!t) return null;
  const sessionIds = (
    db.prepare("SELECT session_id AS s FROM topic_members WHERE topic_id = ?").all(topicId) as Array<{ s: string }>
  ).map((r) => r.s);
  return { name: t.name, sessionIds };
}
