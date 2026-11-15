-- Workstream B: entity resolution working tables (additive only).
BEGIN;
CREATE TABLE IF NOT EXISTS er_candidates (
  id bigserial PRIMARY KEY,
  a_id text NOT NULL,
  b_id text NOT NULL,
  rule text,                       -- deterministic rule that fired, if any
  score real NOT NULL,             -- 0..1 cluster/pair score
  features jsonb NOT NULL DEFAULT '{}',
  decision text NOT NULL CHECK (decision IN ('auto', 'review', 'reject')),
  llm jsonb,                       -- {verdict, rationale, meta}
  merge_log_id bigint,
  run_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (a_id, b_id)
);
CREATE TABLE IF NOT EXISTS er_watchlist (
  key text PRIMARY KEY,            -- spec §3 actor key, e.g. "person:marc-andreessen"
  spec_name text NOT NULL,
  kind text NOT NULL,              -- lab | person | think_tank | pac | funder | ...
  node_id text,                    -- resolved canonical node (null = unresolved)
  status text NOT NULL CHECK (status IN ('resolved', 'ambiguous', 'missing')),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Pending external-ID/alias links we are not sure of (not written to entity_external_ids until confirmed).
CREATE TABLE IF NOT EXISTS er_id_proposals (
  id bigserial PRIMARY KEY,
  node_id text NOT NULL,
  system text NOT NULL,
  value text NOT NULL,
  source_url text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  confidence real,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, system, value)
);
-- Matching attributes learned about a node from public records (never street addresses).
CREATE TABLE IF NOT EXISTS er_attrs (
  id bigserial PRIMARY KEY,
  node_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('city_state', 'zip5', 'employer', 'occupation', 'handle', 'website', 'title')),
  value text NOT NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https?://[^\s]+$'),
  created_by text NOT NULL DEFAULT 'er',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, kind, value)
);
CREATE INDEX IF NOT EXISTS er_attrs_node ON er_attrs (node_id);
COMMIT;
