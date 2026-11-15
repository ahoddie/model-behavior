// Writes a candidate flag to conflict_flags (pending) and the review queue. Shared by run.ts and commitments.ts.
import { createHash } from "node:crypto";
import { pool, q } from "../../../src/lib/db.ts";
import { enqueue } from "../../lib/review.ts";
import type { Ev } from "./core.ts";

export const DRY = process.argv.includes("--dry");
export type Cand = {
  type: "statement_vs_action" | "statement_vs_money" | "commitment_weakened" | "reversal_near_event";
  key: string; node_id: string; target_id: string | null; severity: 1 | 2 | 3; confidence: number;
  description: string; rationale: string; said: Ev[]; did: Ev[]; meta: Record<string, unknown>;
};

export async function store(c: Cand): Promise<"new" | "exists"> {
  const key = createHash("sha1").update(c.key).digest("hex");
  if ((await q(`SELECT 1 FROM sd_flag_keys WHERE key=$1`, [key])).length) return "exists";
  if (DRY) return "new";
  const withArch = (evs: Ev[]) => Promise.all(evs.map(async (e) => ({ ...e, archive_url: e.archive_url ?? (await q<any>(`SELECT archive_url FROM archives WHERE url=$1`, [e.url]))[0]?.archive_url ?? null })));
  const said = await withArch(c.said), did = await withArch(c.did);
  const r = await pool.query(`INSERT INTO conflict_flags (node_id,type,target_id,severity,confidence,description,rationale,said_evidence,did_evidence,extraction_meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [c.node_id, c.type, c.target_id, c.severity, c.confidence, c.description, c.rationale, JSON.stringify(said), JSON.stringify(did), JSON.stringify({ ...c.meta, detector: "say_do-v1" })]);
  const id = r.rows[0].id;
  await pool.query(`INSERT INTO sd_flag_keys (key, flag_id) VALUES ($1,$2)`, [key, id]);
  const ev = [...said, ...did].map((e) => ({ label: e.label, url: e.url, archive_url: e.archive_url, date: e.date }));
  await enqueue({ workstream: "say_do", kind: "conflict_flag", refTable: "conflict_flags", refId: id, title: `${c.type.replace(/_/g, " ")}: ${c.description.slice(0, 140)}`,
    payload: { rationale: c.rationale, type: c.type, node_id: c.node_id, target_id: c.target_id, description: c.description }, evidence: ev, confidence: c.confidence, significance: c.severity * c.confidence });
  return "new";
}
