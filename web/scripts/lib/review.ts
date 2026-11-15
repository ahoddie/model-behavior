// The one review queue (CONTRACTS.md §5). Every workstream sends items for human review through enqueue().
// Nothing a pipeline infers reaches the site until a reviewer approves it on /review.
import { pool } from "../../src/lib/db.ts";

export type Workstream = "statements" | "er" | "say_do" | "money" | "core";
export type Evidence = { label: string; url: string; archive_url?: string | null; date?: string | null };

export type ReviewItem = {
  workstream: Workstream;
  kind: string;                    // "feed_item" | "merge" | "conflict_flag" | "money_hop" | "watchlist_person" | ...
  refTable?: string;               // table holding the item, e.g. "feed_items"
  refId?: string | number;         // its id there
  title: string;                   // one line shown in the list
  payload?: Record<string, unknown>;
  evidence: Evidence[];            // at least one, each with a URL
  confidence?: number | null;      // 0..1
  significance?: number;           // larger = review sooner. Statements: influence tier x stance clarity x recency.
};

export async function enqueue(item: ReviewItem): Promise<number | null> {
  if (!item.evidence.length || item.evidence.some((e) => !/^https?:\/\//.test(e.url))) throw new Error(`review item "${item.title}" needs evidence URLs`);
  const r = await pool.query(
    `INSERT INTO review_queue (source_workstream, kind, ref_table, ref_id, title, payload, evidence, confidence, significance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (source_workstream, kind, ref_table, ref_id) DO UPDATE
       SET title=EXCLUDED.title, payload=EXCLUDED.payload, evidence=EXCLUDED.evidence, confidence=EXCLUDED.confidence, significance=EXCLUDED.significance
       WHERE review_queue.status = 'pending'
     RETURNING id`,
    [item.workstream, item.kind, item.refTable ?? null, item.refId == null ? null : String(item.refId), item.title,
      JSON.stringify(item.payload ?? {}), JSON.stringify(item.evidence), item.confidence ?? null, item.significance ?? 0]);
  return r.rows[0]?.id ?? null;
}

// Approve or reject. For feed_items and conflict_flags the referenced row's status follows the decision.
export async function decide(id: number, status: "approved" | "rejected", note?: string) {
  const r = await pool.query(`UPDATE review_queue SET status=$2, reviewer_note=$3, decided_at=now() WHERE id=$1 RETURNING ref_table, ref_id`, [id, status, note ?? null]);
  const row = r.rows[0];
  if (row?.ref_table === "feed_items" || row?.ref_table === "conflict_flags")
    await pool.query(`UPDATE ${row.ref_table} SET status=$2 WHERE id=$1`, [row.ref_id, status]);
  return row;
}
