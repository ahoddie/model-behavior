-- Model Behavior schema. Rule: no row without a source URL.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE DOMAIN source_url AS text CHECK (VALUE ~ '^https?://[^\s]+$');

CREATE TABLE nodes (
  id            text PRIMARY KEY,
  type          text NOT NULL CHECK (type IN ('lab','person','investor','think_tank','pac','nonprofit','funder','bill','race','rule','lawmaker','agency')),
  name          text NOT NULL,
  descriptor    text,
  cluster       text NOT NULL,
  external_ids  jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url    source_url NOT NULL,
  archive_url   text,
  logo_url      text,          -- the org's own logo file, hot-linked from its site
  logo_source_url source_url,  -- page the logo was taken from
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE links (
  id            bigserial PRIMARY KEY,
  from_id       text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_id         text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('money','person','idea','position')),
  subtype       text,
  amount        numeric(16,2),
  date_start    date,
  date_end      date,
  stance        text,
  note          text,
  source_url    source_url NOT NULL,
  archive_url   text,
  origin        text NOT NULL DEFAULT 'research',   -- research | importer:<name>
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT links_uniq UNIQUE NULLS NOT DISTINCT (from_id, to_id, type, subtype, source_url, amount, date_start)
);
CREATE INDEX links_from ON links(from_id);
CREATE INDEX links_to ON links(to_id);

CREATE TABLE feed_items (
  id            bigserial PRIMARY KEY,
  node_id       text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  date          date NOT NULL,
  kind          text NOT NULL,
  excerpt       text CHECK (excerpt IS NULL OR array_length(regexp_split_to_array(trim(excerpt), '\s+'), 1) <= 25),
  summary       text,
  url           source_url NOT NULL,
  archive_url   text,
  platform      text,
  issues        text[] NOT NULL DEFAULT '{}',
  stance        text,
  target_id     text REFERENCES nodes(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  origin        text NOT NULL DEFAULT 'research',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (excerpt IS NOT NULL OR summary IS NOT NULL),
  CONSTRAINT feed_uniq UNIQUE NULLS NOT DISTINCT (node_id, url, date, kind)
);
CREATE INDEX feed_node ON feed_items(node_id, date DESC);
CREATE INDEX feed_status ON feed_items(status);

CREATE TABLE filings (
  id            bigserial PRIMARY KEY,
  node_id       text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  filing_type   text NOT NULL CHECK (filing_type IN ('FEC','LDA','state lobbying','990','docket comment','position letter')),
  period        text,
  filed_date    date,
  amount        numeric(16,2),
  issues        text[] NOT NULL DEFAULT '{}',
  description   text,
  url           source_url NOT NULL,
  archive_url   text,
  filing_id     text,
  origin        text NOT NULL DEFAULT 'research',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, filing_type, url)
);
CREATE INDEX filings_node ON filings(node_id);

CREATE TABLE facts (
  id            bigserial PRIMARY KEY,
  node_id       text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  text          text NOT NULL,
  url           source_url NOT NULL,
  archive_url   text,
  label         text,          -- key-fact label shown on profiles: Founded, Founders, Leader, Headquarters, Website, ...
  sort          int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, text)
);

-- Wayback archive cache keyed by source URL.
CREATE TABLE archives (
  url           text PRIMARY KEY,
  archive_url   text,
  checked_at    timestamptz NOT NULL DEFAULT now(),
  http_status   int,
  error         text
);

-- Source-check results (link rot / verification).
CREATE TABLE url_checks (
  url           text PRIMARY KEY,
  status        int,
  ok            boolean NOT NULL,
  checked_at    timestamptz NOT NULL DEFAULT now(),
  error         text
);

CREATE TABLE changelog (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  action        text NOT NULL,         -- insert | update | delete | approve | reject
  table_name    text NOT NULL,
  row_ref       text NOT NULL,
  actor         text NOT NULL DEFAULT 'system',
  detail        jsonb
);

CREATE TABLE corrections (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  table_name    text NOT NULL,
  row_ref       text NOT NULL,
  what_changed  text NOT NULL,
  url           source_url NOT NULL
);

CREATE TABLE follows (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL,
  node_id       text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_sent_at  timestamptz,
  UNIQUE (email, node_id)
);

CREATE TABLE import_runs (
  id            bigserial PRIMARY KEY,
  importer      text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  ok            boolean,
  added         int DEFAULT 0,
  message       text
);

-- Changelog triggers on every content table.
CREATE OR REPLACE FUNCTION log_change() RETURNS trigger AS $$
DECLARE ref text; act text; o jsonb; n jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN o := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN n := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND (n - 'archive_url' - 'updated_at') = (o - 'archive_url' - 'updated_at') THEN
    RETURN NULL; -- archive-link refreshes are not edits
  END IF;
  ref := coalesce(n->>'id', o->>'id');
  act := lower(TG_OP);
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'feed_items' AND (o->>'status') IS DISTINCT FROM (n->>'status') THEN
    act := CASE n->>'status' WHEN 'approved' THEN 'approve' WHEN 'rejected' THEN 'reject' ELSE 'update' END;
  END IF;
  INSERT INTO changelog(action, table_name, row_ref, actor, detail)
  VALUES (act, TG_TABLE_NAME, ref, coalesce(nullif(current_setting('mb.actor', true), ''), 'system'), coalesce(n, o));
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER nodes_log AFTER INSERT OR UPDATE OR DELETE ON nodes FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER links_log AFTER INSERT OR UPDATE OR DELETE ON links FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER feed_log  AFTER INSERT OR UPDATE OR DELETE ON feed_items FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER filings_log AFTER INSERT OR UPDATE OR DELETE ON filings FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER facts_log AFTER INSERT OR UPDATE OR DELETE ON facts FOR EACH ROW EXECUTE FUNCTION log_change();

-- Read-path indexes (footer date, race candidate lookups, key facts).
CREATE INDEX IF NOT EXISTS changelog_at ON changelog (at DESC);
CREATE INDEX IF NOT EXISTS nodes_race ON nodes ((external_ids->>'race')) WHERE type='lawmaker';
CREATE INDEX IF NOT EXISTS nodes_type ON nodes (type);
CREATE INDEX IF NOT EXISTS facts_node_label ON facts (node_id, label);
-- Date precision: a source that gives only a year or month is stored at that precision, never padded to a day.
ALTER TABLE links ADD COLUMN IF NOT EXISTS date_start_prec text NOT NULL DEFAULT 'day' CHECK (date_start_prec IN ('day','month','year'));
ALTER TABLE links ADD COLUMN IF NOT EXISTS date_end_prec text NOT NULL DEFAULT 'day' CHECK (date_end_prec IN ('day','month','year'));
ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS date_prec text NOT NULL DEFAULT 'day' CHECK (date_prec IN ('day','month','year'));
ALTER TABLE filings ADD COLUMN IF NOT EXISTS filed_prec text NOT NULL DEFAULT 'day' CHECK (filed_prec IN ('day','month','year'));
-- pdate: the date as text at its stored precision ("2025", "2025-03" or "2025-03-04").
CREATE OR REPLACE FUNCTION pdate(d date, p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN d IS NULL THEN NULL WHEN p='year' THEN to_char(d,'YYYY') WHEN p='month' THEN to_char(d,'YYYY-MM') ELSE d::text END $$;

-- Indexes for profile, target and home queries (audit 2026-11-14).
CREATE INDEX IF NOT EXISTS links_from_type_sub ON links(from_id, type, subtype);
CREATE INDEX IF NOT EXISTS links_to_type ON links(to_id, type);
CREATE INDEX IF NOT EXISTS feed_target_approved ON feed_items(target_id) WHERE status='approved';
-- Rows removed as duplicates are kept here, not destroyed.
CREATE TABLE IF NOT EXISTS links_removed (LIKE links INCLUDING DEFAULTS, removed_at timestamptz DEFAULT now(), reason text, kept_id int);

-- Analysis (machine-classified, labeled as such on the site).
-- issue_areas: the fixed list of policy issues. "Positive" says what a +2 means on that issue.
CREATE TABLE IF NOT EXISTS issue_areas (
  id text PRIMARY KEY, label text NOT NULL, description text NOT NULL, positive text NOT NULL, sort int NOT NULL DEFAULT 0);
-- statement_labels: one row per statement per model and prompt version. Only the statement's own quoted words are read.
CREATE TABLE IF NOT EXISTS statement_labels (
  feed_id int NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  model text NOT NULL, prompt_version text NOT NULL, input_hash text NOT NULL,
  own_voice boolean NOT NULL,
  issues jsonb NOT NULL DEFAULT '{}'::jsonb,          -- {"china": 2, "preemption": -1}; 0 = addresses the issue without a stance
  tone smallint CHECK (tone BETWEEN -2 AND 2),        -- stance on government rules for AI; NULL = no stance
  confidence real CHECK (confidence BETWEEN 0 AND 1),
  reason text,
  labeled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feed_id, model, prompt_version));
-- The fixed issue list. "positive" is the statement a +2 agrees with.
INSERT INTO public.issue_areas VALUES ('catastrophic_risk', 'Catastrophic and existential risk', 'Loss of control over AI, superintelligence, or AI-enabled catastrophes such as bioweapons or large cyberattacks.', 'Catastrophic risks from AI are serious and need action.', 1) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('china', 'US–China competition', 'Competing with China on AI, chip export controls, and keeping US technology out of rival hands.', 'The US should take tougher measures against China on AI, such as stricter export controls.', 2) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('preemption', 'Federal preemption of state laws', 'Whether federal law should override or pause state AI laws.', 'Federal law should override or pause state AI laws.', 3) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('frontier_rules', 'Rules for the most powerful models', 'Required safety testing, transparency reports, incident reporting or audits for frontier AI models.', 'The most powerful AI models should face required safety testing, transparency or reporting.', 4) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('open_models', 'Open-weight models', 'Releasing model weights openly, and open-source AI.', 'AI model weights should be free to release openly.', 5) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('copyright', 'Copyright and training data', 'Whether AI companies may train on copyrighted or personal data without permission or payment.', 'Rights holders should be protected or paid when their work is used to train AI.', 6) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('kids_safety', 'Children and online safety', 'Chatbots and children, age checks, harmful content.', 'Children need new protections from AI chatbots and harmful content.', 7) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('jobs', 'Jobs and the economy', 'AI''s effect on work, wages and the economy.', 'The government should act to protect workers from AI''s effects.', 8) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('energy', 'Energy and data centers', 'Power, data centers and compute buildout.', 'Data centers and power for AI should be built faster, with fewer limits.', 9) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('national_security', 'National security and defense', 'Military and intelligence use of AI, and government adoption.', 'The government and military should use more AI.', 10) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('liability', 'Liability for AI harms', 'Whether AI developers can be held legally responsible for harms.', 'AI developers should be legally liable for harms their systems cause.', 11) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('civil_rights', 'Bias and civil rights', 'Discrimination, bias audits and surveillance.', 'AI needs new protections against bias and discrimination.', 12) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('elections', 'Deepfakes and elections', 'Synthetic media, election ads and disclosure.', 'Deepfakes and AI in elections need new rules.', 13) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('innovation', 'Innovation and competitiveness', 'Keeping US AI development fast and companies competitive.', 'Lighter AI rules are better for innovation and competition.', 14) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
-- filing_issue_tags: topic tags (no stance) for LDA lobbying filings and grant links, from the filed text only.
-- One row per source row per model and prompt version, including rows the AI keyword check skipped (ai_related = false),
-- so counts are kept and re-runs only tag what changed (input_hash). Lobbying links share their filing's URL, so a
-- filing's tags apply to every lobbying link with the same source_url.
CREATE TABLE IF NOT EXISTS filing_issue_tags (
  source_kind   text NOT NULL CHECK (source_kind IN ('filing','grant')),
  source_id     bigint NOT NULL,                      -- filings.id or links.id
  model         text NOT NULL, prompt_version text NOT NULL, input_hash text NOT NULL,
  ai_related    boolean NOT NULL,
  issues        text[] NOT NULL DEFAULT '{}',          -- issue_areas ids
  via           jsonb NOT NULL DEFAULT '{}'::jsonb,    -- {"china": "rule", "energy": "model"}: which pass added each tag
  reason        text,
  tagged_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_id, model, prompt_version));
CREATE INDEX IF NOT EXISTS filing_issue_tags_issues ON filing_issue_tags USING gin (issues);
INSERT INTO public.issue_areas VALUES ('federal_framework', 'Federal AI framework bills', 'Comprehensive federal AI legislation.', 'Congress should pass a comprehensive federal AI law.', 15) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
INSERT INTO public.issue_areas VALUES ('agency_rules', 'Agency rules and executive action', 'Binding rules and executive orders from federal agencies.', 'Federal agencies should issue binding rules on AI.', 16) ON CONFLICT (id) DO UPDATE SET positive=EXCLUDED.positive;
-- Later changes live in db/migrations/*.sql, applied in filename order after this file.
