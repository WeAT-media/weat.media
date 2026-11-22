CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  did         TEXT NOT NULL,
  handle      TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  article_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collections_did_idx ON collections (did, updated_at DESC);
CREATE INDEX IF NOT EXISTS collections_updated_idx ON collections (updated_at DESC);
