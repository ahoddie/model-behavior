-- Positions on a statement (topics), found by the positions pipeline (web/scripts/importers/statements/positions).
-- Most people never say the statement word for word. They imply it in an interview, a post, an op-ed, testimony, a podcast,
-- or a comment letter. Each row is one sourced quote read against one statement: agree, disagree, or mixed, with a confidence.
-- A row shows on the Statements page when its quote was found word for word at its link and its confidence clears the bar
-- (status 'auto'), or when a reviewer confirmed it in /review (status 'confirmed'). Everything else waits ('pending') or is
-- hidden ('rejected'). The speaker may be on the site (node_id) or not yet (node_id null, speaker_name only).
CREATE TABLE IF NOT EXISTS stance_findings (
  id            serial PRIMARY KEY,
  topic_id      text NOT NULL REFERENCES topics(id),
  node_id       text REFERENCES nodes(id) ON DELETE SET NULL,
  speaker_name  text NOT NULL,
  speaker_role  text,                                   -- short descriptor, e.g. "US senator (R-TX)"
  quote         text NOT NULL,                          -- the speaker's own words, copied from the source
  url           text NOT NULL,
  date          text,                                   -- "2025", "2025-07" or "2025-07-05"
  source_kind   text,                                   -- interview, post, op-ed, testimony, podcast, comment letter, speech, other
  origin        text NOT NULL,                          -- 'web' (found by search) or 'feed' (an approved feed item)
  feed_id       integer REFERENCES feed_items(id) ON DELETE CASCADE,
  side          text NOT NULL CHECK (side IN ('agree','disagree','mixed')),
  answer        smallint NOT NULL CHECK (answer BETWEEN -2 AND 2),  -- the page's scale; mixed is 0
  implied       boolean NOT NULL DEFAULT true,          -- false when the quote states the statement nearly outright
  confidence    real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reason        text,
  verified      boolean NOT NULL DEFAULT false,         -- the quote was found word for word in the page at url
  verify_note   text,
  model         text NOT NULL,
  prompt_version text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('auto','pending','confirmed','rejected')),
  review_answer smallint CHECK (review_answer BETWEEN -2 AND 2),
  review_side   text CHECK (review_side IN ('agree','disagree','mixed')),
  review_note   text,
  reviewed_at   timestamptz,
  found_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_id, url, quote)
);
CREATE INDEX IF NOT EXISTS stance_findings_topic ON stance_findings (topic_id, status);
