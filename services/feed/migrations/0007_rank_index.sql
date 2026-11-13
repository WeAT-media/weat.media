-- Ранжирование читает только эти колонки: покрывающий индекс даёт index-only scan по окну hot,
-- не трогая строки статей (в них сжатый текст — таблица в разы тяжелее индекса).
-- Замер на 50 000 статей за 14 дней: hot 588 мс (холодный) / 57 мс → 19 мс.
CREATE INDEX IF NOT EXISTS articles_rank_idx ON articles (published_at DESC) INCLUDE (uri, like_score, comment_count);
-- «последние лайки читателя» и «последние лайкнувшие статью» для рекомендаций
CREATE INDEX IF NOT EXISTS likes_did_time_idx ON likes (did, created_at DESC);
CREATE INDEX IF NOT EXISTS likes_subject_time_idx ON likes (subject_uri, created_at DESC);
