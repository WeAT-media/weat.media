-- Лайки media.weat.like: живут в репозиториях поставивших, здесь — индекс для ранжирования
CREATE TABLE IF NOT EXISTS likes (
  uri          TEXT PRIMARY KEY,
  did          TEXT NOT NULL,
  subject_uri  TEXT NOT NULL,             -- статья
  created_at   TIMESTAMPTZ NOT NULL,
  indexed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (did, subject_uri)               -- повторный лайк той же статьи не считаем
);
CREATE INDEX IF NOT EXISTS likes_subject_idx ON likes (subject_uri);
