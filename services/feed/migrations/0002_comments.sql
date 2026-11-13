-- Комментарии media.weat.comment: живут в репозиториях комментаторов, здесь — индекс для RSS и выдачи
CREATE TABLE IF NOT EXISTS comments (
  uri          TEXT PRIMARY KEY,
  did          TEXT NOT NULL,
  subject_uri  TEXT NOT NULL,             -- статья
  parent_uri   TEXT,                      -- ответ на комментарий
  text         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  indexed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_subject_idx ON comments (subject_uri, created_at DESC);
