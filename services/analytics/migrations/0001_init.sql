-- Открытая аналитика: только дневные агрегаты. Сырые события, IP и User-Agent не хранятся.

CREATE TABLE IF NOT EXISTS article_daily (
  article_id   TEXT   NOT NULL,
  day          DATE   NOT NULL,
  views        BIGINT NOT NULL DEFAULT 0,
  uniques      BIGINT NOT NULL DEFAULT 0,  -- по дневному хешу посетителя
  anon_views   BIGINT NOT NULL DEFAULT 0,  -- просмотры без входа (сигнал анти-накрутки)
  reads        BIGINT NOT NULL DEFAULT 0,  -- дочитывания до конца
  time_ms_sum  BIGINT NOT NULL DEFAULT 0,  -- время на странице
  time_n       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, day)
);
CREATE INDEX IF NOT EXISTS article_daily_day_idx ON article_daily (day);

-- канал: feed | direct | search | social | other; name — домен или площадка
CREATE TABLE IF NOT EXISTS article_sources (
  article_id TEXT   NOT NULL,
  day        DATE   NOT NULL,
  channel    TEXT   NOT NULL,
  name       TEXT   NOT NULL,
  views      BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, day, channel, name)
);

CREATE TABLE IF NOT EXISTS article_utm (
  article_id   TEXT   NOT NULL,
  day          DATE   NOT NULL,
  utm_source   TEXT   NOT NULL,
  utm_medium   TEXT   NOT NULL DEFAULT '',
  utm_campaign TEXT   NOT NULL DEFAULT '',
  views        BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, day, utm_source, utm_medium, utm_campaign)
);

-- для подсчёта уникальных: хеш живёт сутки, затем строки удаляются (prune)
CREATE TABLE IF NOT EXISTS article_visitors (
  article_id TEXT  NOT NULL,
  day        DATE  NOT NULL,
  visitor    BYTEA NOT NULL,
  PRIMARY KEY (article_id, day, visitor)
);
