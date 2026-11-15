-- Workstream E (bill wording provenance): prov_matches (CONTRACTS.md section 9) plus working tables. Additive only. Prefix prov_.
BEGIN;

-- Every text we hold: each tracked bill version and each earlier source (report, comment letter, model bill, op-ed, statement, earlier bill).
-- The raw text lives under data/cache/provenance/ (git-ignored) and is never shown; this table holds only metadata.
CREATE TABLE IF NOT EXISTS prov_texts (
  id bigserial PRIMARY KEY,
  bill_node_id text REFERENCES nodes(id) ON DELETE CASCADE,   -- set when the text is a version of a tracked bill/rule
  version text,                                               -- e.g. "Introduced", "A6453B", "Enrolled"
  source_kind text NOT NULL CHECK (source_kind IN ('bill_version','think_tank','comment_letter','model_bill','op_ed','statement','testimony','executive_order','agency_text','other')),
  title text NOT NULL,
  author_id text REFERENCES nodes(id) ON DELETE SET NULL,     -- only an existing node id (from resolve()); new authors go to the review queue
  author_name text,
  text_date date NOT NULL,
  url source_url NOT NULL,                                    -- the page a person opens
  fetch_url text NOT NULL,                                    -- what we downloaded (a PDF or XML copy of the same text, or a Wayback copy)
  archive_url text,
  text_path text,                                             -- relative to data/cache/provenance/
  text_sha1 text,
  n_words int,
  fetched_via text,                                           -- direct | wayback
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fetch_url)
);
CREATE INDEX IF NOT EXISTS prov_texts_bill ON prov_texts (bill_node_id);

-- Candidate clause pairs found by fuzzy overlap, with the model's verdict. One row per (bill clause, source clause).
CREATE TABLE IF NOT EXISTS prov_cands (
  id bigserial PRIMARY KEY,
  bill_text_id bigint NOT NULL REFERENCES prov_texts(id) ON DELETE CASCADE,
  bill_clause int NOT NULL,
  src_text_id bigint NOT NULL REFERENCES prov_texts(id) ON DELETE CASCADE,
  src_clause int NOT NULL,
  shingle_jaccard real NOT NULL,
  containment real NOT NULL,                                  -- share of the bill clause's word 4-grams found in the source clause
  cosine real NOT NULL,                                       -- tf-idf cosine over word unigrams and bigrams
  score real NOT NULL,                                        -- max of the three, the number we threshold on
  relation text CHECK (relation IN ('word_for_word','lightly_edited','paraphrase','not_related')),
  reason text,
  llm_meta jsonb,
  match_id bigint,                                            -- prov_matches.id once stored
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bill_text_id, bill_clause, src_text_id, src_clause)
);
CREATE INDEX IF NOT EXISTS prov_cands_score ON prov_cands (score DESC);

-- The contract table read by /api/v1/bills/<id>/wording-sources (CONTRACTS.md section 9).
CREATE TABLE IF NOT EXISTS prov_matches (
  id bigserial PRIMARY KEY,
  bill_node_id text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  bill_version text,
  bill_date date,
  bill_url source_url NOT NULL,
  bill_archive_url text,
  bill_clause text NOT NULL,                                  -- cut to 25 words or fewer
  source_kind text NOT NULL,
  source_title text NOT NULL,
  source_author_id text,
  source_date date NOT NULL,
  source_url source_url NOT NULL,
  source_archive_url text,
  source_clause text NOT NULL,                                -- cut to 25 words or fewer
  similarity real NOT NULL,
  kind text NOT NULL CHECK (kind IN ('verbatim','light_edit','paraphrase')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  extraction_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prov_matches_bill ON prov_matches (bill_node_id, status);
-- Our own link from a match back to the candidate pair, so a re-run never duplicates a match.
CREATE UNIQUE INDEX IF NOT EXISTS prov_matches_cand ON prov_matches ((extraction_meta->>'cand_id'));

COMMIT;
