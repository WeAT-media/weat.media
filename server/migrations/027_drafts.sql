-- Черновики статей: личные, не публикуются в репозиторий (он публичен) — хранятся у AppView до публикации.
CREATE TABLE IF NOT EXISTS drafts (
  id          TEXT PRIMARY KEY,            -- dr_<random>
  did         TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',     -- markdown редактора
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drafts_did_idx ON drafts (did, updated_at DESC);
