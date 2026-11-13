-- Счётчики реакций в карточке статьи: лента и ранжирование читают их без count() по likes/comments.
-- Держатся триггерами — любой путь записи (firehose, backfill, delete_repo) обновляет их одинаково.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS like_count    INT NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS comment_count INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION bump_article_counter() RETURNS trigger AS $$
DECLARE
  col TEXT := TG_ARGV[0];
BEGIN
  IF TG_OP = 'INSERT' THEN
    EXECUTE format('UPDATE articles SET %I = %I + 1 WHERE uri = $1', col, col) USING NEW.subject_uri;
  ELSIF TG_OP = 'DELETE' THEN
    EXECUTE format('UPDATE articles SET %I = greatest(%I - 1, 0) WHERE uri = $1', col, col) USING OLD.subject_uri;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS likes_count ON likes;
CREATE TRIGGER likes_count AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION bump_article_counter('like_count');
DROP TRIGGER IF EXISTS comments_count ON comments;
CREATE TRIGGER comments_count AFTER INSERT OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION bump_article_counter('comment_count');

-- лайк или комментарий мог прийти раньше самой статьи (порядок backfill, чужой репозиторий) — досчитываем при вставке
CREATE OR REPLACE FUNCTION init_article_counters() RETURNS trigger AS $$
BEGIN
  NEW.like_count := (SELECT count(*) FROM likes WHERE subject_uri = NEW.uri);
  NEW.comment_count := (SELECT count(*) FROM comments WHERE subject_uri = NEW.uri);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS articles_counters ON articles;
CREATE TRIGGER articles_counters BEFORE INSERT ON articles
  FOR EACH ROW EXECUTE FUNCTION init_article_counters();

UPDATE articles a SET
  like_count = (SELECT count(*) FROM likes l WHERE l.subject_uri = a.uri),
  comment_count = (SELECT count(*) FROM comments c WHERE c.subject_uri = a.uri);
