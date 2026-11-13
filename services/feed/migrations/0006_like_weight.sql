-- Защита ранжирования от накрутки: у лайка есть вес, ранжирование считает их сумму (like_score),
-- а людям по-прежнему показываем число лайков (like_count).
--   своя статья            — 0    (самолайк не поднимает запись)
--   аккаунт моложе суток   — 0.25 (свежие аккаунты — дешёвый материал для накрутки)
--   моложе недели          — 0.5
--   остальные              — 1
-- «Возраст» — когда индекс впервые увидел аккаунт, а не createdAt записи: её подделать легко.

CREATE TABLE IF NOT EXISTS actors (
  did         TEXT PRIMARY KEY,
  first_seen  TIMESTAMPTZ NOT NULL
);
-- уже проиндексированные: по самой ранней их записи
INSERT INTO actors (did, first_seen)
SELECT did, min(t) FROM (
  SELECT did, created_at AS t FROM articles
  UNION ALL SELECT did, created_at FROM comments
  UNION ALL SELECT did, created_at FROM likes
) x GROUP BY did
ON CONFLICT (did) DO NOTHING;

ALTER TABLE likes ADD COLUMN IF NOT EXISTS weight REAL NOT NULL DEFAULT 1;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS like_score REAL NOT NULL DEFAULT 0;

-- вес — в момент лайка; позже не пересчитываем (аккаунт «дорос» — новые лайки весят больше)
CREATE OR REPLACE FUNCTION like_weight(liker TEXT, subject TEXT, at TIMESTAMPTZ) RETURNS REAL AS $$
  SELECT CASE
    WHEN split_part(subject, '/', 3) = liker THEN 0
    WHEN a.first_seen IS NULL OR at - a.first_seen < interval '1 day' THEN 0.25
    WHEN at - a.first_seen < interval '7 days' THEN 0.5
    ELSE 1
  END::real
  FROM (SELECT 1) one LEFT JOIN actors a ON a.did = liker
$$ LANGUAGE sql STABLE;

UPDATE likes SET weight = like_weight(did, subject_uri, created_at);

CREATE OR REPLACE FUNCTION bump_like_score() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE articles SET like_score = like_score + NEW.weight WHERE uri = NEW.subject_uri;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE articles SET like_score = greatest(like_score - OLD.weight, 0) WHERE uri = OLD.subject_uri;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS likes_score ON likes;
CREATE TRIGGER likes_score AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION bump_like_score();

-- статья пришла позже лайков — досчитываем и счётчик, и сумму весов
CREATE OR REPLACE FUNCTION init_article_counters() RETURNS trigger AS $$
BEGIN
  NEW.like_count := (SELECT count(*) FROM likes WHERE subject_uri = NEW.uri);
  NEW.like_score := (SELECT coalesce(sum(weight), 0) FROM likes WHERE subject_uri = NEW.uri);
  NEW.comment_count := (SELECT count(*) FROM comments WHERE subject_uri = NEW.uri);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

UPDATE articles a SET like_score = (SELECT coalesce(sum(weight), 0) FROM likes l WHERE l.subject_uri = a.uri);
