-- Indexes for the profile page reads (web/src/lib/data.ts). Additive only.
-- Measured 2026-11-15: per-profile lookups on links, feed_items, filings and facts already use indexes
-- (links_from_type_sub, links_to_type, feed_node, filings_node, facts_node_label). These cover the rest:

-- "Newest label per statement" (LABELS in data.ts): DISTINCT ON (feed_id) ... ORDER BY feed_id, labeled_at DESC.
CREATE INDEX IF NOT EXISTS statement_labels_feed_newest ON statement_labels (feed_id, labeled_at DESC);

-- "Newest tag row per filing or grant" (FILING_TAGS): DISTINCT ON (source_kind, source_id) ... ORDER BY tagged_at DESC.
CREATE INDEX IF NOT EXISTS filing_issue_tags_newest ON filing_issue_tags (source_kind, source_id, tagged_at DESC);

-- getMergedInto(), run when a profile id is not found.
CREATE INDEX IF NOT EXISTS merge_log_merged ON merge_log (merged_id) WHERE action = 'merge' AND status = 'applied' AND reverted_at IS NULL;
