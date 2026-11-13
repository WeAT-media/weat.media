-- Индекс статей media.weat.article. Источник правды — репозитории авторов; это кэш для выдачи.
CREATE TABLE IF NOT EXISTS articles (
  uri          TEXT PRIMARY KEY,                -- at://did/media.weat.article/rkey
  did          TEXT NOT NULL,
  rkey         TEXT NOT NULL,
  cid          TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,            -- из записи (createdAt), для сортировки
  indexed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  title        TEXT NOT NULL,
  tags         TEXT[] NOT NULL DEFAULT '{}',
  langs        TEXT[] NOT NULL DEFAULT '{}',
  source_site  TEXT,                            -- не NULL — внешний источник (краулер, репост)
  paid         BOOLEAN NOT NULL DEFAULT false,
  record       JSONB NOT NULL
);
-- лента: новые сверху, keyset-пагинация по (created_at, uri)
CREATE INDEX IF NOT EXISTS articles_feed_idx ON articles (created_at DESC, uri DESC);
CREATE INDEX IF NOT EXISTS articles_tags_idx ON articles USING GIN (tags);
CREATE INDEX IF NOT EXISTS articles_did_idx ON articles (did, created_at DESC);

CREATE TABLE IF NOT EXISTS handles (
  did        TEXT PRIMARY KEY,
  handle     TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- позиция в потоке событий: после перезапуска продолжаем с неё
CREATE TABLE IF NOT EXISTS cursors (
  source TEXT PRIMARY KEY,
  seq    BIGINT NOT NULL
);
