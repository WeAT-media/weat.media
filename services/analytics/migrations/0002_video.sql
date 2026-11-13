-- Видео: запуски и досмотры до конца (≥ 90% длительности). Как и остальное — дневные агрегаты.
ALTER TABLE article_daily ADD COLUMN IF NOT EXISTS plays     BIGINT NOT NULL DEFAULT 0;
ALTER TABLE article_daily ADD COLUMN IF NOT EXISTS completes BIGINT NOT NULL DEFAULT 0;
