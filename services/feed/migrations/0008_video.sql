-- Видео-записи: тип записи и досмотры.
-- kind     — 'video', если в записи kind = video или непустой videos; иначе 'text'
-- completes — досмотры до конца (≥ 90%) за окно hot, их приносит синхронизация с analytics (completions.rs)
ALTER TABLE articles ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS completes INT NOT NULL DEFAULT 0;

UPDATE articles SET kind = 'video'
WHERE record->>'kind' = 'video' OR jsonb_array_length(coalesce(record->'videos', '[]'::jsonb)) > 0;

-- фильтр «только видео» и досмотры — в покрывающем индексе ранжирования, иначе пропал бы index-only scan
DROP INDEX IF EXISTS articles_rank_idx;
CREATE INDEX articles_rank_idx ON articles (published_at DESC) INCLUDE (uri, like_score, comment_count, completes, kind);
