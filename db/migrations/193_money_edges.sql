-- One row per distinct money edge for Follow the money (web/src/lib/data.ts CHAIN_EDGES, web/scripts/pipelines/money/export.ts).
-- money_hops holds each hop once per chain, so one pair of parties can repeat dozens of times. The old CHAIN_EDGES grouped those
-- rows with correlated subqueries per hop and per group; the planner priced that above jit_above_cost, and JIT compilation alone
-- took 10-15 s under load. This view computes each hop's filed-line stats once (one pass over money_x_hop_txns), then groups.
-- Same rows and values as the old SQL: every hop in a group has the same stance and line count (checked 2026-11-15), so taking
-- the group's max equals the old "first hop of the group". It is a plain view, so it is never stale after a money build.
CREATE OR REPLACE VIEW money_edges AS
WITH lines AS (
  SELECT ht.hop_id, max(x.support_oppose) AS so, count(*)::int AS n
    FROM money_x_hop_txns ht LEFT JOIN money_x_fec_tx x ON x.id = ht.tx_id
   GROUP BY ht.hop_id
), grouped AS (
  SELECT coalesce(h.from_id, 'undisclosed:' || h.to_id) AS from_id, h.to_id, h.hop_basis,
         max(h.amount)::float8 AS amount, min(h.source_url) AS source_url, min(h.archive_url) AS archive_url, max(h.date)::text AS date,
         CASE max(l.so) WHEN 'S' THEN 'support' WHEN 'O' THEN 'oppose' END AS stance,
         max(coalesce(l.n, 0))::int AS n_lines
    FROM money_hops h LEFT JOIN lines l ON l.hop_id = h.id
   GROUP BY 1, 2, 3, (CASE WHEN h.hop_basis = 'disclosed' THEN coalesce(l.so, '') ELSE '' END)
)
SELECT g.from_id, g.to_id, g.hop_basis, coalesce(f.name, 'Undisclosed donors') AS from_name, t.name AS to_name, t.type AS to_type,
       g.amount, g.source_url, g.archive_url, g.date, g.stance, g.n_lines
  FROM grouped g JOIN nodes t ON t.id = g.to_id LEFT JOIN nodes f ON f.id = g.from_id;
