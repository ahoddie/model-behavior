-- Rule-based issue tags for statements (web/scripts/tag-issues-rules.ts). No language model: keyword patterns, bill names and the
-- statement's target. Kept beside the model's labels (statement_labels), never replacing them or feed_items.issues.
-- One row per statement per rules version, including statements where no rule fired (issues = '{}'), so a re-run only touches changes.
BEGIN;
CREATE TABLE IF NOT EXISTS statement_issue_rules (
  feed_id       int NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  rules_version text NOT NULL,
  input_hash    text NOT NULL,
  issues        text[] NOT NULL DEFAULT '{}',          -- issue_areas ids, no stance
  via           jsonb NOT NULL DEFAULT '{}'::jsonb,    -- {"china": "text: export control", "preemption": "target: us-ai-moratorium-2025"}
  tagged_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feed_id, rules_version)
);
CREATE INDEX IF NOT EXISTS statement_issue_rules_issues ON statement_issue_rules USING gin (issues);
COMMIT;
