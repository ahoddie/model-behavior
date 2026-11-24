-- Statements can be taken off the Statements page without deleting them or the letters and readings attached to them.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS shown boolean NOT NULL DEFAULT true;
