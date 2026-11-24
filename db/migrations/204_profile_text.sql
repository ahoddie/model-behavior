-- Plain-language text for each person's and organization's profile: a one-sentence headline, a ~50-word description
-- with links to other profiles marked [shown text](node-id), and the sources behind it, shown at the bottom of the page.
-- Written in data/profiles/*.json and loaded by web/scripts/load-profile-text.ts. nodes.descriptor stays as the short label
-- used on the map and in lists.
CREATE TABLE IF NOT EXISTS profile_text (
  node_id     text PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  headline    text NOT NULL,
  description text NOT NULL,
  sources     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ label, name, url }]
  thin        boolean NOT NULL DEFAULT false,       -- the record supports only a short description
  batch       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
