// Apply config/feed_targets.tsv: what each approved statement is about, as read from its own source page.
// Sets feed_items.target_id (+ stance_target when the target is in config/taxonomy.yaml) or, when the bill, rule or
// action has no node yet, feed_items.context. New targets with an official page go to the review queue as kind "node".
// Only target_id, stance_target and context are written; no rows are created or deleted in feed_items or nodes.
import { readFileSync } from "node:fs";
import { pool } from "../../../src/lib/db.ts";
import { enqueue } from "../../lib/review.ts";
import { setActor } from "../../lib/ingest.ts";

const root = new URL("../../../../", import.meta.url).pathname;
const taxonomyTargets = new Set([...readFileSync(`${root}config/taxonomy.yaml`, "utf8").matchAll(/^\s*- \{ id: ([\w-]+), node:/gm)].map((m) => m[1]));
const rows = readFileSync(`${root}config/feed_targets.tsv`, "utf8").trim().split("\n").slice(1).map((l) => {
  const [id, target, context, basis] = l.split("\t");
  return { id: Number(id), target: target || null, context: context || null, basis };
});

// Targets that need a node. Evidence: the official Federal Register notice, plus the statements that cite it.
const FR = "https://www.federalregister.gov/documents/";
const NEW_NODES: { id: string; type: string; name: string; context: string; official: string }[] = [
  { id: "ntia-ai-accountability-rfc-2023", type: "rule", name: "NTIA AI Accountability Policy Request for Comment (2023)", context: "NTIA AI accountability request for comment (2023)", official: `${FR}2023/04/13/2023-07776/ai-accountability-policy-request-for-comment` },
  { id: "nist-eo14110-rfi-2023", type: "rule", name: "NIST RFI on its assignments under Executive Order 14110 (2023)", context: "NIST request for information under Executive Order 14110 (2023)", official: `${FR}2023/12/21/2023-28232/request-for-information-rfi-related-to-nists-assignments-under-sections-41-45-and-11-of-the` },
  { id: "ntia-open-weights-rfc-2024", type: "rule", name: "NTIA Request for Comment on Dual Use Foundation Models With Widely Available Model Weights (2024)", context: "NTIA request for comment on open-weight foundation models (2024)", official: `${FR}2024/02/26/2024-03763/dual-use-foundation-artificial-intelligence-models-with-widely-available-model-weights` },
  { id: "ntia-data-center-rfc-2024", type: "rule", name: "NTIA Request for Comments on Bolstering Data Center Growth, Resilience, and Security (2024)", context: "NTIA request for comment on data center growth and security (2024)", official: `${FR}2024/09/04/2024-19524/request-for-comments-on-bolstering-data-center-growth-resilience-and-security` },
  { id: "doe-ai-infrastructure-rfi-2025", type: "rule", name: "DOE Request for Information on AI Infrastructure on DOE Lands (2025)", context: "DOE request for information on AI infrastructure on DOE lands (2025)", official: `${FR}2025/04/07/2025-05936/request-for-information-on-artificial-intelligence-infrastructure-on-doe-lands` },
  { id: "ita-ai-exports-program-rfi-2025", type: "rule", name: "Commerce RFI on the American AI Exports Program (2025)", context: "Commerce request for information on the American AI Exports Program (2025)", official: `${FR}2025/10/28/2025-19674/american-ai-exports-program` },
  { id: "omb-ai-governance-memo-rfc-2023", type: "rule", name: "OMB Request for Comments on draft memo: Advancing Governance, Innovation, and Risk Management for Agency Use of AI (2023)", context: "OMB draft memo on agency AI governance (2023)", official: `${FR}2023/11/03/2023-24269/request-for-comments-on-advancing-governance-innovation-and-risk-management-for-agency-use-of` },
  { id: "omb-ai-procurement-rfi-2024", type: "rule", name: "OMB RFI on Responsible Procurement of AI in Government (2024)", context: "OMB request for information on responsible AI procurement (2024)", official: `${FR}2024/03/29/2024-06547/request-for-information-responsible-procurement-of-artificial-intelligence-in-government` },
  { id: "ostp-national-priorities-ai-rfi-2023", type: "rule", name: "OSTP RFI on National Priorities for Artificial Intelligence (2023)", context: "OSTP request for information on national AI priorities (2023)", official: `${FR}2023/05/26/2023-11346/request-for-information-national-priorities-for-artificial-intelligence` },
];

await setActor("core:feed-targets");
const known = new Set((await pool.query(`SELECT id FROM nodes`)).rows.map((r) => r.id));
let targeted = 0, contexted = 0;
for (const r of rows) {
  if (r.target && !known.has(r.target)) throw new Error(`feed ${r.id}: no node ${r.target}`);
  const res = await pool.query(
    `UPDATE feed_items SET target_id=$2, stance_target=$3, context=$4 WHERE id=$1 AND status='approved'`,
    [r.id, r.target, r.target && taxonomyTargets.has(r.target) ? r.target : null, r.target ? null : r.context]);
  if (res.rowCount !== 1) throw new Error(`feed ${r.id}: not an approved item`);
  if (r.target) targeted++; else contexted++;
}

let queued = 0;
for (const n of NEW_NODES) {
  if (known.has(n.id)) continue;
  const feeds = rows.filter((r) => r.context === n.context).map((r) => r.id);
  const cites = (await pool.query(`SELECT id, url, archive_url, date::text FROM feed_items WHERE id = ANY($1) ORDER BY id`, [feeds])).rows;
  const id = await enqueue({
    workstream: "core", kind: "node", refTable: "nodes", refId: n.id,
    title: `New target needs a node: ${n.name}`,
    payload: { node: { id: n.id, type: n.type, name: n.name, source_url: n.official }, feed_ids: feeds, context: n.context,
      rationale: "Approved statements respond to this notice. Once the node exists, set target_id on these feed items and clear context." },
    evidence: [{ label: "Official notice (Federal Register)", url: n.official }, ...cites.map((c) => ({ label: `Statement ${c.id}`, url: c.url, archive_url: c.archive_url, date: c.date }))],
    confidence: 0.9, significance: feeds.length,
  });
  if (id) queued++;
}
console.log(JSON.stringify({ targeted, contexted, queued }));
await pool.end();
