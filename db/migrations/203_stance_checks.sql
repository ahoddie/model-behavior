-- A person's check of one machine reading on the Stances page: does this quote, from this speaker, take this side of this topic?
-- Keyed by quote and topic, not by model or prompt version, so a decision outlives re-labeling and one quote counts once.
-- The Stances page shows a quote only when its row here is 'confirmed', and uses the answer stored here (the reviewer may correct it).
-- Letter signatures (topic_positions) are the signer's own act and need no row.
CREATE TABLE IF NOT EXISTS stance_checks (
  feed_id     integer NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  topic_id    text NOT NULL REFERENCES topics(id),
  verdict     text NOT NULL CHECK (verdict IN ('confirmed','rejected')),
  answer      smallint CHECK (answer BETWEEN -2 AND 2),   -- the reviewer's reading; required when confirmed
  machine     smallint,                                    -- what the model said at review time, kept for agreement counts
  note        text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feed_id, topic_id),
  CHECK (verdict <> 'confirmed' OR answer IS NOT NULL)
);
