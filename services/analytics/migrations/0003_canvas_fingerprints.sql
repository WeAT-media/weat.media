-- Дневные группы открытой canvas-сигнатуры: SHA-256, без исходных изображений и данных WebGL.
CREATE TABLE IF NOT EXISTS article_canvas_fingerprints (
  article_id TEXT      NOT NULL,
  day        DATE      NOT NULL,
  hash       CHAR(64)  NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  views      BIGINT    NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, day, hash)
);
CREATE INDEX IF NOT EXISTS article_canvas_fingerprints_day_idx ON article_canvas_fingerprints (day);
