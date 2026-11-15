-- Workstream D (money): working tables. Additive only. Prefix money_x_.
BEGIN;

-- Parsed FEC itemized lines (Schedule A receipts, B disbursements, E independent expenditures) from raw .fec filings.
-- No street addresses, phone numbers or emails are stored (CONTRACTS rule 5): city and state only.
CREATE TABLE IF NOT EXISTS money_x_fec_tx (
  id bigserial PRIMARY KEY,
  committee_id text NOT NULL,
  node_id text,
  file_number text NOT NULL,
  form_type text NOT NULL,              -- F3X, F3, F24, F5 ...
  report_code text,                     -- YE, Q1, 12G, 24 ...
  amendment text,                       -- N new, A amendment, T termination
  coverage_start date,
  coverage_end date,
  sched text NOT NULL CHECK (sched IN ('A', 'B', 'E')),
  line_code text,                       -- SA11AI, SB21B, SE ...
  transaction_id text NOT NULL,
  entity_type text,                     -- IND, ORG, PAC, COM, CCM ...
  name text,                            -- organisation name, or "LAST, FIRST"
  employer text,
  occupation text,
  city text,
  state text,
  tx_date date,
  amount numeric(16,2) NOT NULL,
  purpose text,
  other_committee_id text,              -- donor committee (A) or beneficiary committee (B)
  candidate_id text,
  candidate_name text,
  candidate_office text,
  candidate_state text,
  candidate_district text,
  support_oppose text,                  -- S / O (Schedule E)
  election_code text,
  dissemination_date date,
  memo boolean NOT NULL DEFAULT false,
  memo_text text,
  superseded boolean NOT NULL DEFAULT false,   -- replaced by a later amendment / same transaction in a later filing
  source_url source_url NOT NULL,
  archive_url text,
  UNIQUE (file_number, transaction_id)
);
CREATE INDEX IF NOT EXISTS money_x_fec_tx_cmte ON money_x_fec_tx (committee_id, sched, superseded);

CREATE TABLE IF NOT EXISTS money_x_fec_filings (
  file_number text PRIMARY KEY,
  committee_id text NOT NULL,
  form_type text, report_code text, amendment text,
  coverage_start date, coverage_end date,
  total_receipts numeric(16,2), total_disbursements numeric(16,2),
  superseded boolean NOT NULL DEFAULT false
);

-- One row per underlying filing line behind a (possibly aggregated) hop.
CREATE TABLE IF NOT EXISTS money_x_hop_txns (
  hop_id bigint NOT NULL REFERENCES money_hops(id) ON DELETE CASCADE,
  tx_id bigint REFERENCES money_x_fec_tx(id),
  link_id bigint,
  amount numeric(16,2),
  tx_date date,
  source_url source_url NOT NULL,
  archive_url text
);
CREATE INDEX IF NOT EXISTS money_x_hop_txns_hop ON money_x_hop_txns (hop_id);

CREATE TABLE IF NOT EXISTS money_x_chain_meta (
  chain_id bigint PRIMARY KEY REFERENCES money_chains(id) ON DELETE CASCADE,
  network text,
  origin_kind text,        -- person | organization | undisclosed | committee
  disclosed_amount numeric(16,2) NOT NULL DEFAULT 0,
  self_reported_amount numeric(16,2) NOT NULL DEFAULT 0,
  undisclosed_amount numeric(16,2),            -- NULL = amount not knowable from filings
  has_undisclosed boolean NOT NULL DEFAULT false,
  note text
);

CREATE TABLE IF NOT EXISTS money_x_reconcile (
  id bigserial PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  committee_id text NOT NULL, node_id text, cycle int NOT NULL,
  metric text NOT NULL,                        -- receipts | disbursements | independent_expenditures | transfers_out
  fec_total numeric(16,2), our_total numeric(16,2),
  diff numeric(16,2), pct numeric(8,3),
  fec_source text,                             -- api_totals | f3x_summary
  explanation text,
  status text NOT NULL DEFAULT 'open'          -- ok | explained | open
);

CREATE TABLE IF NOT EXISTS money_x_ads (
  id bigserial PRIMARY KEY,
  node_id text, committee_id text,
  platform text NOT NULL,                      -- fec_se | meta | google | fcc
  external_id text,
  spend_low numeric(16,2), spend_high numeric(16,2), amount numeric(16,2),
  start_date date, end_date date,
  placement text,                              -- vendor / medium / region as filed
  target_node text, target_label text, support_oppose text,
  description text,
  source_url source_url NOT NULL,
  archive_url text
);
COMMIT;
