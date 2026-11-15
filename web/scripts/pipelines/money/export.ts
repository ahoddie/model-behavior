// Canonical SQL + CLI for the Follow-the-money export (spec §7 view 4). The same queries are mirrored in web/src/lib/data.ts
// (moneyChainFlows / moneyChainStarts), which the page calls. Output rows have the shape <MoneyFlow> takes
// ({from_id,to_id,from_name,to_name,amount,d,source_url,stance}) plus hop_basis, undisclosed, archive_url, n_lines.
//   tsx export.ts                 # writes data/exports/money/{index,<start>}.json for every starting point
import "../../env.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO } from "../../env.ts";
import { q, pool } from "../../../src/lib/db.ts";

export const CHAIN_EDGES = `
  SELECT coalesce(h.from_id, 'undisclosed:' || h.to_id) AS from_id, h.to_id, h.hop_basis,
         coalesce(f.name, 'Undisclosed donors') AS from_name, t.name AS to_name, t.type AS to_type,
         max(h.amount)::float8 AS amount, min(h.source_url) AS source_url, min(h.archive_url) AS archive_url, max(h.date)::text AS date,
         (SELECT max(CASE x.support_oppose WHEN 'S' THEN 'support' WHEN 'O' THEN 'oppose' END) FROM money_x_hop_txns ht JOIN money_x_fec_tx x ON x.id=ht.tx_id WHERE ht.hop_id = (array_agg(h.id))[1]) AS stance,
         (SELECT count(*)::int FROM money_x_hop_txns ht WHERE ht.hop_id = (array_agg(h.id))[1]) AS n_lines
    FROM money_hops h JOIN nodes t ON t.id=h.to_id LEFT JOIN nodes f ON f.id=h.from_id
   GROUP BY 1, 2, 3, 4, 5, 6, (CASE WHEN h.hop_basis='disclosed' THEN coalesce((SELECT max(x.support_oppose) FROM money_x_hop_txns ht JOIN money_x_fec_tx x ON x.id=ht.tx_id WHERE ht.hop_id=h.id), '') ELSE '' END)`;

export async function moneyFlowExport(start: string, depth = 4) {
  return q<any>(`
    WITH RECURSIVE edge AS (${CHAIN_EDGES}),
    walk(from_id, to_id, from_name, to_name, to_type, amount, source_url, archive_url, date, stance, hop_basis, n_lines, d, path) AS (
      SELECT from_id, to_id, from_name, to_name, to_type, amount, source_url, archive_url, date, stance, hop_basis, n_lines, 1, ARRAY[from_id, to_id] FROM edge WHERE from_id=$1
      UNION ALL
      SELECT e.from_id, e.to_id, e.from_name, e.to_name, e.to_type, e.amount, e.source_url, e.archive_url, e.date, e.stance, e.hop_basis, e.n_lines, w.d+1, w.path || e.to_id
        FROM edge e JOIN walk w ON e.from_id=w.to_id WHERE w.d < $2 AND NOT e.to_id = ANY(w.path))
    SELECT DISTINCT ON (from_id, to_id, stance) *, (hop_basis='undisclosed') AS undisclosed FROM walk ORDER BY from_id, to_id, stance, d`, [start, depth]);
}

export async function moneyStartsExport() {
  return q<any>(`
    WITH edge AS (${CHAIN_EDGES})
    SELECT from_id AS id, from_name AS name, CASE WHEN hop_basis='undisclosed' THEN 'undisclosed' ELSE (SELECT type FROM nodes WHERE id=edge.from_id) END AS type,
           sum(amount)::float8 AS out, min(hop_basis) AS basis
      FROM edge WHERE from_id NOT IN (SELECT id FROM nodes WHERE type='lawmaker')
      GROUP BY from_id, from_name, hop_basis HAVING hop_basis='undisclosed' OR sum(amount) > 0
        AND from_id NOT IN (SELECT to_id FROM edge e2 WHERE e2.hop_basis<>'undisclosed' AND e2.to_type IN ('pac','nonprofit') AND e2.from_id <> edge.from_id)
      ORDER BY (hop_basis='undisclosed'), sum(amount) DESC NULLS LAST`);
}

async function main() {
  const dir = resolve(REPO, "data/exports/money");
  mkdirSync(dir, { recursive: true });
  const starts = await moneyStartsExport();
  writeFileSync(resolve(dir, "index.json"), JSON.stringify(starts, null, 1));
  for (const s of starts) writeFileSync(resolve(dir, `${s.id.replace(/[^a-z0-9-]+/gi, "_")}.json`), JSON.stringify(await moneyFlowExport(s.id), null, 1));
  console.log(`${starts.length} starting points written to data/exports/money/`);
  await pool.end();
}
if (import.meta.url === `file://${process.argv[1]}`) main();
