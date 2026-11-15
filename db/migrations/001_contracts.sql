-- Shared contracts (data/CONTRACTS.md §5). Additive only: no existing column or row changes meaning.
BEGIN;

-- feed_items: structured extraction fields. The older `stance`, `target_id` and `issues` columns stay for the current site;
-- pipelines write both until the site reads the new ones.
ALTER TABLE feed_items
  ADD COLUMN IF NOT EXISTS stance_target text,                         -- taxonomy target id (data/taxonomy.yaml); equals nodes.id when node-backed
  ADD COLUMN IF NOT EXISTS issue_tags text[] NOT NULL DEFAULT '{}',    -- taxonomy issue ids only
  ADD COLUMN IF NOT EXISTS reg_attitude smallint CHECK (reg_attitude BETWEEN -2 AND 2),
  ADD COLUMN IF NOT EXISTS confidence real CHECK (confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS attribution text CHECK (attribution IN ('direct', 'quoted', 'paraphrased')),
  ADD COLUMN IF NOT EXISTS extraction_meta jsonb;                      -- {model, prompt_version, extracted_at, input_hash, ...}
CREATE INDEX IF NOT EXISTS feed_stance_target ON feed_items (stance_target) WHERE stance_target IS NOT NULL;
-- A paraphrase can never be shown as a quote.
ALTER TABLE feed_items DROP CONSTRAINT IF EXISTS feed_paraphrase_no_quote;
ALTER TABLE feed_items ADD CONSTRAINT feed_paraphrase_no_quote CHECK (attribution IS DISTINCT FROM 'paraphrased' OR excerpt IS NULL);

-- Entity resolution
CREATE TABLE IF NOT EXISTS entity_aliases (
  id bigserial PRIMARY KEY,
  node_id text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  alias text NOT NULL,
  alias_norm text NOT NULL,
  kind text NOT NULL DEFAULT 'name' CHECK (kind IN ('name', 'employer_string', 'handle', 'committee_name', 'legal_name', 'former_name')),
  source_url source_url NOT NULL,
  created_by text NOT NULL DEFAULT 'core',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, alias_norm, kind)
);
CREATE INDEX IF NOT EXISTS entity_aliases_norm ON entity_aliases (alias_norm);

CREATE TABLE IF NOT EXISTS entity_external_ids (
  system text NOT NULL,          -- fec_committee, fec_candidate, lda_registrant, lda_client, lda_lobbyist, ein, bioguide, openstates, wikidata, opencorporates, bluesky_did, mastodon, threads, website
  value text NOT NULL,
  node_id text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  source_url source_url NOT NULL,
  created_by text NOT NULL DEFAULT 'core',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (system, value)
);
CREATE INDEX IF NOT EXISTS entity_external_ids_node ON entity_external_ids (node_id);

CREATE TABLE IF NOT EXISTS merge_log (
  id bigserial PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('merge', 'split')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'reverted', 'rejected')),
  kept_id text NOT NULL,
  merged_id text NOT NULL,
  snapshot jsonb,                -- full rows moved or changed, enough to reverse
  method text NOT NULL CHECK (method IN ('rule', 'llm', 'human')),
  evidence jsonb NOT NULL DEFAULT '[]',
  rationale text,
  confidence real,
  extraction_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  reverted_at timestamptz
);

-- Say-vs-do
CREATE TABLE IF NOT EXISTS conflict_flags (
  id bigserial PRIMARY KEY,
  node_id text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('statement_vs_action', 'statement_vs_money', 'commitment_weakened', 'reversal_near_event')),
  target_id text,                -- taxonomy target id
  severity smallint NOT NULL CHECK (severity BETWEEN 1 AND 3),
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  description text NOT NULL,     -- one neutral sentence, public
  rationale text,                -- reviewers only
  said_evidence jsonb NOT NULL,  -- [{label, url, archive_url, date, ref_table, ref_id}]
  did_evidence jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  extraction_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_array_length(said_evidence) > 0 AND jsonb_array_length(did_evidence) > 0)
);
CREATE INDEX IF NOT EXISTS conflict_flags_node ON conflict_flags (node_id, status);

-- Money chains
CREATE TABLE IF NOT EXISTS money_chains (
  id bigserial PRIMARY KEY,
  source_node text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_node text REFERENCES nodes(id) ON DELETE SET NULL,
  label text,
  created_by text NOT NULL DEFAULT 'money',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS money_hops (
  id bigserial PRIMARY KEY,
  chain_id bigint NOT NULL REFERENCES money_chains(id) ON DELETE CASCADE,
  seq smallint NOT NULL,
  from_id text REFERENCES nodes(id),           -- NULL only when hop_basis = 'undisclosed' (the "Undisclosed donors" placeholder)
  from_label text,
  to_id text NOT NULL REFERENCES nodes(id),
  amount numeric,
  date date,
  date_prec text NOT NULL DEFAULT 'day' CHECK (date_prec IN ('day', 'month', 'year')),
  hop_basis text NOT NULL CHECK (hop_basis IN ('disclosed', 'self_reported', 'undisclosed')),
  source_url source_url NOT NULL,
  archive_url text,
  filing_id text,
  link_id int,                                  -- links.id when the hop is also a map link
  UNIQUE (chain_id, seq),
  CHECK (from_id IS NOT NULL OR hop_basis = 'undisclosed')
);

-- One review queue for all workstreams
CREATE TABLE IF NOT EXISTS review_queue (
  id bigserial PRIMARY KEY,
  source_workstream text NOT NULL CHECK (source_workstream IN ('statements', 'er', 'say_do', 'money', 'core')),
  kind text NOT NULL,            -- feed_item, merge, conflict_flag, money_hop, watchlist_person, ...
  ref_table text,
  ref_id text,
  title text NOT NULL,           -- one line for the review list
  payload jsonb NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '[]',   -- [{label, url, archive_url}]
  confidence real CHECK (confidence BETWEEN 0 AND 1),
  significance real NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (source_workstream, kind, ref_table, ref_id)
);
CREATE INDEX IF NOT EXISTS review_queue_open ON review_queue (status, significance DESC, confidence DESC);

COMMIT;
