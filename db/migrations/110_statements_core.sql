-- Workstream A (statements): working tables. Additive only; shared tables are untouched.
BEGIN;

-- Who is on the watchlist and why. Rebuilt by `pnpm statements:watchlist`; data/watchlist.yaml is the readable export.
CREATE TABLE IF NOT EXISTS stmt_watchlist (
  node_id        text PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  influence_tier smallint NOT NULL CHECK (influence_tier BETWEEN 1 AND 3),   -- 3 = most influential (CONTRACTS.md section 5)
  score          real NOT NULL,
  score_parts    jsonb NOT NULL DEFAULT '{}',        -- {role, money, audience, ...} so the tier can be audited
  basis          jsonb NOT NULL,                     -- [{kind, detail, url, date?}] each with a source url
  first_listed   timestamptz NOT NULL DEFAULT now(),
  built_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_array_length(basis) > 0)
);

-- Handles. Only status = 'verified' handles are ingested. Verified means the person's own site, an official bio, or a
-- domain handle on the person's own domain links to / is that account (verified_via is that page).
CREATE TABLE IF NOT EXISTS stmt_handles (
  node_id      text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('bluesky', 'mastodon', 'threads', 'x', 'substack', 'blog_rss', 'youtube', 'website')),
  handle       text NOT NULL,                        -- bluesky: handle; mastodon: user@instance; rss: feed url
  did          text,                                 -- bluesky DID
  status       text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'verified', 'rejected')),
  verified_via source_url,
  verified_at  timestamptz,
  followers    integer,
  note         text,
  PRIMARY KEY (node_id, platform, handle),
  CHECK (status <> 'verified' OR verified_via IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS stmt_handles_did ON stmt_handles (did) WHERE did IS NOT NULL;

-- Every item the pipeline has looked at, kept as ids and outcomes only (no text) so reruns and the firehose never redo work
-- and dropped items are not stored beyond their id.
CREATE TABLE IF NOT EXISTS stmt_seen (
  item_key     text PRIMARY KEY,                     -- sha1(canonical url | speaker node)
  source       text NOT NULL,
  outcome      text NOT NULL CHECK (outcome IN ('irrelevant', 'no_statement', 'bad_quote', 'duplicate', 'stored', 'skipped')),
  feed_item_id bigint,
  prompt_versions text,                              -- which prompt set decided it (so a new version can re-open dropped items)
  seen_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stmt_seen_source ON stmt_seen (source, seen_at DESC);

-- Resume points for backfills and polling.
CREATE TABLE IF NOT EXISTS stmt_cursors (
  source     text NOT NULL,
  key        text NOT NULL,
  cursor     text,
  done       boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, key)
);

COMMIT;
