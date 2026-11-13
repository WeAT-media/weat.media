-- Время публикации оригинала: source.publishedAt у краулера и репоста, иначе created_at.
-- Ранжирование считает возраст от него — импорт старой новости не делает её свежей.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- уже проиндексированное: та же логика, что в record.rs (не позже created_at, только валидный ISO)
UPDATE articles SET published_at = CASE
  WHEN record->'source'->>'publishedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
   AND (record->'source'->>'publishedAt')::timestamptz <= created_at
  THEN (record->'source'->>'publishedAt')::timestamptz
  ELSE created_at
END
WHERE published_at IS NULL;

ALTER TABLE articles ALTER COLUMN published_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published_at DESC);
