-- Workstream E (bill wording provenance) sends matches through the shared review queue.
ALTER TABLE review_queue DROP CONSTRAINT IF EXISTS review_queue_source_workstream_check;
ALTER TABLE review_queue ADD CONSTRAINT review_queue_source_workstream_check
  CHECK (source_workstream = ANY (ARRAY['statements','er','say_do','money','provenance','core']));
