-- Dated action history and roll-call tallies for public bill records (bills). Plain public record only:
-- the date, the action as the source words it, and vote counts where the source gives them. Additive; safe to re-run.

CREATE TABLE IF NOT EXISTS bill_actions (
  bill_id   text NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  seq       int  NOT NULL,                 -- order within the bill, oldest first
  date      date NOT NULL,
  text      text NOT NULL,                 -- verbatim from the source
  chamber   text CHECK (chamber IN ('lower','upper','joint','executive')),
  kind      text,                          -- coarse: introduced, committee, passed, failed, governor, enacted, vetoed, other
  PRIMARY KEY (bill_id, seq)
);
CREATE INDEX IF NOT EXISTS bill_actions_date ON bill_actions (bill_id, date);

CREATE TABLE IF NOT EXISTS bill_votes (
  bill_id     text NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  seq         int  NOT NULL,
  date        date NOT NULL,
  chamber     text CHECK (chamber IN ('lower','upper','joint')),
  motion      text NOT NULL,               -- what was voted on, verbatim
  yes         int,
  no          int,
  other       int,                         -- abstaining, absent, not voting, where given
  result      text,                        -- passed | failed, where given
  source_url  text,                        -- the roll call itself, where the source links one
  PRIMARY KEY (bill_id, seq)
);
