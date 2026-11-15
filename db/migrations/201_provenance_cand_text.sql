-- Workstream E: keep the full clause pair next to each candidate so evaluation and review never depend on re-splitting. Local only; never served.
BEGIN;
ALTER TABLE prov_cands ADD COLUMN IF NOT EXISTS bill_text text;
ALTER TABLE prov_cands ADD COLUMN IF NOT EXISTS src_text text;
COMMIT;
