import type { Db } from "./init.js";
import { createHash } from "node:crypto";
import type { Segment } from "../lib/segment.js";

/** Stable signature of a session's segmentation — changes only if a segment's
 *  start line or opener changes, so cached labels invalidate exactly then. */
export function spineHash(segments: Segment[]): string {
  const basis = JSON.stringify(segments.map((s) => [s.startLine, s.opener]));
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export type SaveLabelsInput = {
  sessionId: string;
  spineHash: string;
  labels: string[];
  model: string;
  costUsd: number;
};

export function saveLabels(db: Db, rec: SaveLabelsInput): void {
  db.prepare(
    `INSERT INTO segment_labels (session_id, spine_hash, labels_json, model, cost_usd, created_at)
     VALUES (@sessionId, @spineHash, @labelsJson, @model, @costUsd, @createdAt)
     ON CONFLICT(session_id) DO UPDATE SET
       spine_hash  = excluded.spine_hash,
       labels_json = excluded.labels_json,
       model       = excluded.model,
       cost_usd    = excluded.cost_usd,
       created_at  = excluded.created_at`
  ).run({
    sessionId: rec.sessionId,
    spineHash: rec.spineHash,
    labelsJson: JSON.stringify(rec.labels),
    model: rec.model,
    costUsd: rec.costUsd,
    createdAt: Date.now(),
  });
}

export function getLabels(
  db: Db,
  sessionId: string
): { spineHash: string; labels: string[] } | null {
  const row = db
    .prepare("SELECT spine_hash AS spineHash, labels_json AS labelsJson FROM segment_labels WHERE session_id = ?")
    .get(sessionId) as { spineHash: string; labelsJson: string } | undefined;
  if (!row) return null;
  let labels: string[] = [];
  try { labels = JSON.parse(row.labelsJson); } catch { labels = []; }
  return { spineHash: row.spineHash, labels };
}
