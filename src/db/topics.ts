import type Database from "better-sqlite3";
import type { TopicCluster } from "../labeling/cluster-topics.js";

export type TopicSummary = { id: number; name: string; sessionCount: number };

/** Replace all topics with a freshly clustered set (atomic). */
export function replaceTopics(db: Database.Database, clusters: TopicCluster[]): void {
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

export function listTopics(db: Database.Database): TopicSummary[] {
  return db
    .prepare(
      `SELECT t.id, t.name, COUNT(m.session_id) AS sessionCount
         FROM topics t LEFT JOIN topic_members m ON m.topic_id = t.id
        GROUP BY t.id, t.name
        ORDER BY sessionCount DESC, t.name ASC`
    )
    .all() as TopicSummary[];
}

export function getTopic(db: Database.Database, topicId: number): { name: string; sessionIds: string[] } | null {
  const t = db.prepare("SELECT name FROM topics WHERE id = ?").get(topicId) as { name: string } | undefined;
  if (!t) return null;
  const sessionIds = (
    db.prepare("SELECT session_id AS s FROM topic_members WHERE topic_id = ?").all(topicId) as Array<{ s: string }>
  ).map((r) => r.s);
  return { name: t.name, sessionIds };
}
