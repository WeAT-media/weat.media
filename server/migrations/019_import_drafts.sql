-- Черновики из импорта постов AT-аккаунта (app.bsky.feed.post): автор просматривает и выпускает сам.
-- source_uri — исходный пост; повторный импорт его не дублирует.
CREATE TABLE IF NOT EXISTS import_drafts (
  id                 TEXT PRIMARY KEY,                    -- imp_<random>
  did                TEXT NOT NULL,                       -- автор на нашем PDS
  source_uri         TEXT NOT NULL,
  source_created_at  TIMESTAMPTZ NOT NULL,
  title              TEXT NOT NULL,
  text               TEXT NOT NULL,                       -- markdown для редактора
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'dismissed')),
  article_uri        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (did, source_uri)
);
CREATE INDEX IF NOT EXISTS import_drafts_did_idx ON import_drafts (did, status, source_created_at DESC);
