-- Аккаунты краулеров на нашем PDS: от их имени публикуются перенесённые статьи
CREATE TABLE IF NOT EXISTS crawler_accounts (
  id            TEXT PRIMARY KEY,            -- habr-1
  handle        TEXT NOT NULL UNIQUE,        -- crawler-habr-1.indie.media
  did           TEXT NOT NULL UNIQUE,
  password_enc  TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  site          TEXT NOT NULL,               -- habr.com
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Каждая ссылка, которую поставили в очередь (вручную админом или из RSS)
CREATE TABLE IF NOT EXISTS crawler_items (
  id             BIGSERIAL PRIMARY KEY,
  url            TEXT NOT NULL,
  url_canonical  TEXT NOT NULL UNIQUE,       -- без utm и фрагмента: повторно не публикуем
  crawler_id     TEXT NOT NULL REFERENCES crawler_accounts (id),
  status         TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'published', 'failed')),
  origin         TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'source')),
  requested_by   TEXT,
  title          TEXT,
  at_uri         TEXT,
  error          TEXT,
  attempts       INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crawler_items_created_idx ON crawler_items (created_at DESC);

-- Источники для автоматического пуша: RSS опрашивается по расписанию
CREATE TABLE IF NOT EXISTS crawler_sources (
  id              BIGSERIAL PRIMARY KEY,
  crawler_id      TEXT NOT NULL REFERENCES crawler_accounts (id),
  url             TEXT NOT NULL UNIQUE,
  interval_min    INT NOT NULL DEFAULT 30 CHECK (interval_min BETWEEN 5 AND 1440),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  last_polled_at  TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
