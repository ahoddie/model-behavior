-- money_edges (193) now follows the display rule from 195_small_gifts_hidden.sql: it groups money_hops_shown, not money_hops,
-- so a gift under $1,000 is left out unless it comes from a person whose total giving is over $1,000. Null amounts
-- (undisclosed hops) stay. Same columns and rows as CHAIN_EDGES over money_hops_shown. Needs 193 and 195.
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
    FROM money_hops_shown h LEFT JOIN lines l ON l.hop_id = h.id
   GROUP BY 1, 2, 3, (CASE WHEN h.hop_basis = 'disclosed' THEN coalesce(l.so, '') ELSE '' END)
)
SELECT g.from_id, g.to_id, g.hop_basis, coalesce(f.name, 'Undisclosed donors') AS from_name, t.name AS to_name, t.type AS to_type,
       g.amount, g.source_url, g.archive_url, g.date, g.stance, g.n_lines
  FROM grouped g JOIN nodes t ON t.id = g.to_id LEFT JOIN nodes f ON f.id = g.from_id;
