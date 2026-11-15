-- Workstream C (say-vs-do): working tables and input views. Additive only. Prefix sd_.
BEGIN;

-- Who sponsors or champions a bill. Only rows with an official source (bill page, legislature site).
CREATE TABLE IF NOT EXISTS sd_bill_sponsors (
  target_id text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  lawmaker_id text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'sponsor' CHECK (role IN ('sponsor', 'cosponsor', 'author')),
  source_url source_url NOT NULL,
  archive_url text,
  PRIMARY KEY (target_id, lawmaker_id, role)
);

-- Bill version history. A position is only compared with another position on the same substantive version.
-- `substantive` = the amendment changed what the bill does in a way that matters to the position (judged by the loader, with source).
CREATE TABLE IF NOT EXISTS sd_bill_versions (
  target_id text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  label text NOT NULL,                       -- e.g. "Amended in Assembly 2024-08-22"
  effective_from date NOT NULL,
  substantive_change boolean NOT NULL DEFAULT true,   -- false = clerical/technical; positions on either side still compare
  note text,
  source_url source_url NOT NULL,
  archive_url text,
  PRIMARY KEY (target_id, effective_from)
);

-- Pages watched for commitment changes (type 3) and the existing Wayback snapshots found for them (CDX). Nothing is archived by us here.
CREATE TABLE IF NOT EXISTS sd_page_watch (
  id serial PRIMARY KEY,
  node_id text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  page_url source_url NOT NULL UNIQUE,
  topic text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sd_page_snapshots (
  page_id int NOT NULL REFERENCES sd_page_watch(id) ON DELETE CASCADE,
  ts char(14) NOT NULL,
  snapshot_url source_url NOT NULL,
  digest text,
  text_hash text,
  PRIMARY KEY (page_id, ts)
);

-- Dedup key for flags, so a re-run updates nothing and creates nothing new.
CREATE TABLE IF NOT EXISTS sd_flag_keys (
  key text PRIMARY KEY,
  flag_id bigint NOT NULL REFERENCES conflict_flags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sd_runs (
  id serial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{}'
);

-- Which side of "said vs did" a stance record is on. Said = public statements. Did = formal acts: letters, docket and RFI
-- comments, committee-analysis support/oppose listings and legislators' official listings of supporters.
CREATE OR REPLACE FUNCTION sd_channel(subtype text, url text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN subtype IN ('letter', 'docket comment', 'rfi comment', 'lobbied on') THEN 'did'
    WHEN url ~* '^https?://(sjud\.senate\.ca\.gov|apcp\.assembly\.ca\.gov|[a-z.]*leginfo\.legislature\.ca\.gov|calmatters\.digitaldemocracy\.org|[a-z.]*assembly\.ca\.gov|[a-z.]*senate\.ca\.gov|www\.commerce\.senate\.gov|files\.nitrd\.gov|[a-z.]*regulations\.gov)' THEN 'did'
    ELSE 'said' END $$;

-- Every stance on a bill, rule or other named target, said or did. Picks up approved feed items (Workstream A) and position links.
CREATE OR REPLACE VIEW sd_positions AS
SELECT 'feed_items'::text AS ref_table, f.id::text AS ref_id, f.node_id AS actor_id,
       coalesce(f.stance_target, f.target_id) AS target_id, f.stance, f.date, f.date_prec,
       'said'::text AS channel, f.kind AS kind, f.excerpt, f.summary AS text, f.url, f.archive_url, f.attribution, f.platform
FROM feed_items f
WHERE f.status = 'approved' AND coalesce(f.stance_target, f.target_id) IS NOT NULL AND f.stance IN ('support', 'oppose', 'support_if_amended', 'mixed')
UNION ALL
SELECT 'links', l.id::text, l.from_id, l.to_id, l.stance, l.date_start, l.date_start_prec,
       sd_channel(l.subtype, l.source_url), l.subtype, NULL::text, l.note, l.source_url, l.archive_url, NULL::text, NULL::text
FROM links l JOIN nodes t ON t.id = l.to_id AND t.type IN ('bill', 'rule')
WHERE l.type = 'position' AND l.stance IN ('support', 'oppose', 'support_if_amended', 'mixed');

-- Money moving between nodes: map links plus Workstream D's disclosed hops (hops already mirrored as links are left out).
CREATE OR REPLACE VIEW sd_money_edges AS
SELECT 'links'::text AS ref_table, l.id::text AS ref_id, l.from_id, l.to_id, l.amount, l.date_start AS date, l.date_start_prec AS date_prec,
       l.subtype, 'disclosed'::text AS basis, l.source_url, l.archive_url, l.note
FROM links l WHERE l.type = 'money' AND l.subtype IN ('contribution', 'donation', 'transfer') AND l.amount IS NOT NULL
UNION ALL
SELECT 'money_hops', h.id::text, h.from_id, h.to_id, h.amount, h.date, h.date_prec, 'hop', h.hop_basis, h.source_url, h.archive_url, h.from_label
FROM money_hops h WHERE h.from_id IS NOT NULL AND h.amount IS NOT NULL AND h.link_id IS NULL AND h.hop_basis <> 'undisclosed';

-- Independent expenditures for or against a candidate.
CREATE OR REPLACE VIEW sd_ie AS
SELECT l.id::text AS ref_id, l.from_id AS spender_id, l.to_id AS candidate_id, l.stance, l.amount, l.date_start AS date, l.date_start_prec AS date_prec,
       l.source_url, l.archive_url, l.note
FROM links l WHERE l.type = 'money' AND l.subtype = 'independent expenditure' AND l.stance IN ('support', 'oppose');

COMMIT;
