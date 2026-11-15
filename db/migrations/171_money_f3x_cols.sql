BEGIN;
ALTER TABLE money_x_fec_filings ADD COLUMN IF NOT EXISTS f3x_cols jsonb;   -- raw column-A summary numbers keyed by field index (22..60)
COMMIT;
