-- Защита от дублей при публикации (сверх одинаковой ссылки):
--   canonical_page — адрес статьи по самому сайту (<link rel="canonical">, у habr — номер статьи)
--   title_key      — нормализованный заголовок: тот же текст с другого сайта (перепост) не публикуется второй раз
ALTER TABLE crawler_items ADD COLUMN IF NOT EXISTS canonical_page TEXT, ADD COLUMN IF NOT EXISTS title_key TEXT;
CREATE INDEX IF NOT EXISTS crawler_items_canonical_page_idx ON crawler_items (canonical_page) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS crawler_items_title_key_idx ON crawler_items (title_key) WHERE status = 'published';
