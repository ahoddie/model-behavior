BEGIN;
-- Hops for parties that have no node yet (awaiting review). Moved into money_hops once the node exists.
CREATE TABLE IF NOT EXISTS money_x_staged_hops (
  id bigserial PRIMARY KEY,
  committee_node text NOT NULL, party_name text NOT NULL, party_kind text, provisional_id text,
  amount numeric(16,2) NOT NULL, tx_date date, tx_id bigint UNIQUE, source_url source_url NOT NULL
);
COMMIT;
