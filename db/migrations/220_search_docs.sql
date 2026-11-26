-- Site search in Postgres (replaces Meilisearch). One row per search result: a profile, an approved statement or a
-- filing, already collapsed so the same item appears once (scripts/index-search.ts fills it; `pnpm run index`).
-- The tsvector is weighted: title and other names (A), the speaker or filer (B), the text (C), issue tags (D).
-- Additive; safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS search_docs (
  key        text PRIMARY KEY,                -- node-<id> | feed-<id> | filing-<id>
  kind       text NOT NULL CHECK (kind IN ('node','feed','filing')),
  node_id    text NOT NULL,
  node_type  text,
  node_name  text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  aliases    text NOT NULL DEFAULT '',        -- other names, space-joined (searched, not shown)
  issues     text NOT NULL DEFAULT '',        -- issue tags, space-joined
  url        text,
  date       text,
  amount     float8,
  weight     int  NOT NULL DEFAULT 0,          -- profiles: number of links, a small tie-breaker
  also       jsonb NOT NULL DEFAULT '[]',      -- [{id, name}] of duplicates folded into this row
  tsv        tsvector GENERATED ALWAYS AS (
               setweight(to_tsvector('english', title || ' ' || aliases), 'A') ||
               setweight(to_tsvector('english', node_name), 'B') ||
               setweight(to_tsvector('english', body), 'C') ||
               setweight(to_tsvector('english', replace(issues, '_', ' ')), 'D')) STORED
);
CREATE INDEX IF NOT EXISTS search_docs_tsv ON search_docs USING gin (tsv);
CREATE INDEX IF NOT EXISTS search_docs_title_trgm ON search_docs USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS search_docs_kind ON search_docs (kind);
