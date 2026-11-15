BEGIN;
-- Plain-text label for what a statement is about (a bill, rule, executive action or race), used when the target
-- has no node yet. Sourced from the statement's own source page. The site shows it as "On <context>" when target_id is null.
ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS context text;
COMMIT;
