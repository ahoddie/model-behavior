-- Notable topics: general themes in AI policy talk (extinction risk, loss of control, ...), each a plain statement a speaker
-- can agree or disagree with. Separate from issue_areas so the main analyzer's issue list stays short.
-- A topic either has its own labels (topic_labels, one question per quote) or reuses an existing issue (issue_id).
CREATE TABLE IF NOT EXISTS topics (
  id text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL,
  positive text NOT NULL,          -- the statement speakers agree or disagree with
  keywords text,                   -- case-insensitive regex; only quotes matching it are sent to the model
  issue_id text REFERENCES issue_areas(id),
  sort int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS topic_labels (
  feed_id integer NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  topic_id text NOT NULL REFERENCES topics(id),
  model text NOT NULL,
  prompt_version text NOT NULL,
  input_hash text NOT NULL,
  answer smallint,                 -- -2..2, null when the quote is not about the topic
  reason text,
  labeled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feed_id, topic_id, model, prompt_version)
);
INSERT INTO topics (id, label, description, positive, keywords, issue_id, sort) VALUES
 ('x_risk', 'Extinction risk', 'Whether advanced AI could kill or permanently disempower humanity.', 'AI could cause human extinction.',
  'extinct|existential|x-risk|xrisk|wipe out|end of humanity|doom|human survival|annihilat', NULL, 1),
 ('loss_of_control', 'Loss of control', 'Whether people could lose control of advanced AI systems, including misaligned or deceptive systems.', 'Humans could lose control of advanced AI systems.',
  'los[es]+ control|lose control|out of control|uncontrollab|rogue|misalign|alignment|control problem|takeover|superintelligen|deceptive|scheming', NULL, 2),
 ('rsi', 'Recursive self-improvement', 'AI that automates AI research and development, and whether that speed-up needs oversight.', 'AI that automates its own research and development needs special oversight.',
  'self-improv|self improv|recursive|automat\w* (ai )?(research|r&d)|ai r&d|intelligence explosion|automated researcher|ai building ai|pace the frontier|pacing|takeoff', NULL, 3),
 ('evaluators', 'Embedded and independent evaluators', 'Government or outside testers checking frontier models, such as AI Safety Institutes embedded with labs.', 'Government or independent evaluators should test frontier AI models before release.',
  'evaluat|\mevals?\M|red.?team|\maisi\M|caisi|safety institute|third.?party|audit|pre-?deployment|independent test', NULL, 4),
 ('china', 'China policy', 'Competing with China on AI, chip export controls, and keeping US technology out of rival hands.', 'The US should take tougher measures against China on AI, such as stricter export controls.', NULL, 'china', 5),
 ('catastrophic', 'Catastrophic risk', 'AI-enabled catastrophes such as bioweapons or large cyberattacks.', 'Catastrophic risks from AI are serious and need action.', NULL, 'catastrophic_risk', 6)
ON CONFLICT (id) DO NOTHING;
