-- Display rule (user request, 2026-11-15): leave out donations under $1,000, except gifts from a person whose total giving
-- is over $1,000. Nothing is deleted; the site reads these views instead of the base tables. Null amounts (lobbying contacts,
-- undisclosed hops) are kept; abs() keeps refunds of $1,000 or more. A person's total is the larger of their summed links and their summed chain steps, so the same
-- FEC lines counted in both places are not added twice.
CREATE OR REPLACE VIEW people_over_1k AS
  SELECT g.from_id AS id FROM (
    SELECT from_id, sum(amount) AS total FROM links WHERE type = 'money' AND coalesce(subtype, '') <> 'lobbying' AND from_id IS NOT NULL GROUP BY from_id
    UNION ALL
    SELECT from_id, sum(amount) FROM money_hops WHERE from_id IS NOT NULL GROUP BY from_id) g
  JOIN nodes n ON n.id = g.from_id AND n.type = 'person'
  GROUP BY g.from_id HAVING max(g.total) > 1000;

CREATE OR REPLACE VIEW links_shown AS
  SELECT l.* FROM links l
  WHERE NOT (l.type = 'money' AND coalesce(l.subtype, '') <> 'lobbying' AND coalesce(abs(l.amount), 1000) < 1000
             AND l.from_id NOT IN (SELECT id FROM people_over_1k));

CREATE OR REPLACE VIEW money_hops_shown AS
  SELECT h.* FROM money_hops h
  WHERE NOT (coalesce(abs(h.amount), 1000) < 1000 AND (h.from_id IS NULL OR h.from_id NOT IN (SELECT id FROM people_over_1k)));
