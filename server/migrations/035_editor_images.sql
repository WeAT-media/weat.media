CREATE TABLE IF NOT EXISTS editor_images (
  cid        TEXT PRIMARY KEY,
  did        TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  bytes      BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS editor_images_did_idx ON editor_images (did, created_at DESC);
