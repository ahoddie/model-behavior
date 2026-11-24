-- Public bill records: every AI-relevant bill found in an official source, whether or not it is on the map.
-- Curated bill nodes (nodes.type='bill') point to their row through bills.node_id. Additive only; safe to re-run.

CREATE TABLE IF NOT EXISTS jurisdictions (
  code   text PRIMARY KEY,                 -- 'us' for Congress, else the lowercase USPS state code
  name   text NOT NULL,
  level  text NOT NULL CHECK (level IN ('federal','state')),
  sort   int  NOT NULL                     -- federal first (0), then states alphabetically by name
);
INSERT INTO jurisdictions (code, name, level, sort) VALUES ('us', 'Federal', 'federal', 0) ON CONFLICT (code) DO NOTHING;
INSERT INTO jurisdictions (code, name, level, sort)
SELECT code, name, 'state', 1 + row_number() OVER (ORDER BY name) FROM (VALUES
  ('al','Alabama'),('ak','Alaska'),('az','Arizona'),('ar','Arkansas'),('ca','California'),('co','Colorado'),('ct','Connecticut'),
  ('de','Delaware'),('dc','District of Columbia'),('fl','Florida'),('ga','Georgia'),('hi','Hawaii'),('id','Idaho'),('il','Illinois'),
  ('in','Indiana'),('ia','Iowa'),('ks','Kansas'),('ky','Kentucky'),('la','Louisiana'),('me','Maine'),('md','Maryland'),
  ('ma','Massachusetts'),('mi','Michigan'),('mn','Minnesota'),('ms','Mississippi'),('mo','Missouri'),('mt','Montana'),
  ('ne','Nebraska'),('nv','Nevada'),('nh','New Hampshire'),('nj','New Jersey'),('nm','New Mexico'),('ny','New York'),
  ('nc','North Carolina'),('nd','North Dakota'),('oh','Ohio'),('ok','Oklahoma'),('or','Oregon'),('pa','Pennsylvania'),
  ('pr','Puerto Rico'),('ri','Rhode Island'),('sc','South Carolina'),('sd','South Dakota'),('tn','Tennessee'),('tx','Texas'),
  ('ut','Utah'),('vt','Vermont'),('va','Virginia'),('wa','Washington'),('wv','West Virginia'),('wi','Wisconsin'),('wy','Wyoming')
) s(code, name)
ON CONFLICT (code) DO NOTHING;

-- Lifecycle stage, in order. 'proposed' is announced or drafted but not filed; the last three are where a bill ends.
--   proposed, introduced, in_committee, passed_one_chamber, passed_legislature, enacted, vetoed, failed
CREATE TABLE IF NOT EXISTS bills (
  id               text PRIMARY KEY,             -- us-119-hr3447, ca-20252026-ab1018, ny-2025-2026-s8828
  jurisdiction     text NOT NULL REFERENCES jurisdictions(code),
  session          text NOT NULL,                -- '119' for Congress, the legislature's own session id for states
  identifier       text NOT NULL,                -- as the legislature writes it: 'H.R. 3447', 'AB 1018'
  bill_type        text,                         -- hr, s, hjres, sjres, ab, sb, ...
  number           text,
  chamber          text CHECK (chamber IN ('lower','upper','joint')),
  title            text NOT NULL,
  introduced_date  date,
  stage            text NOT NULL CHECK (stage IN ('proposed','introduced','in_committee','passed_one_chamber','passed_legislature','enacted','vetoed','failed')),
  stage_date       date,
  status_text      text,                         -- the latest action, verbatim from the source
  status_date      date,
  sponsor          text,                         -- primary sponsor or lead author, as the source names them
  subjects         text[] NOT NULL DEFAULT '{}', -- the source's own subject terms, when it has them
  ai_match         text,                         -- why it counts as AI-relevant: 'subject', 'title', or 'curated'
  source           text NOT NULL,                -- govinfo | leginfo | openstates | research
  source_url       source_url NOT NULL,          -- the official bill page
  data_url         text,                         -- the machine-readable record it was read from
  node_id          text REFERENCES nodes(id) ON DELETE SET NULL,
  external_ids     jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_modified  timestamptz,                  -- when the source last changed the record, to skip unchanged ones
  first_seen       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (jurisdiction, session, identifier)
);
CREATE INDEX IF NOT EXISTS bills_jur_stage ON bills (jurisdiction, stage);
CREATE INDEX IF NOT EXISTS bills_status_date ON bills (status_date DESC NULLS LAST);
CREATE UNIQUE INDEX IF NOT EXISTS bills_node ON bills (node_id) WHERE node_id IS NOT NULL;

-- What each source has already been scanned up to, including records that turned out not to be about AI, so a daily
-- refresh only fetches what changed. key is the source's own record id (a GovInfo file name, a LegInfo bill id).
CREATE TABLE IF NOT EXISTS bill_scan (
  source    text NOT NULL,
  key       text NOT NULL,
  modified  timestamptz,
  relevant  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (source, key)
);
