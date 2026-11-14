-- Отсрочка считается от уведомления автора, а не от выхода статьи:
--   held     — найдено, ждёт: сотрудник пишет автору, что статья будет опубликована
--   queued   — после «Написал автору»: публикация не раньше publish_after (notified_at + delay_hours источника)
--   skipped  — сотрудник решил не публиковать
ALTER TABLE crawler_items DROP CONSTRAINT IF EXISTS crawler_items_status_check;
ALTER TABLE crawler_items ADD CONSTRAINT crawler_items_status_check CHECK (status IN ('held', 'queued', 'running', 'published', 'failed', 'skipped'));
ALTER TABLE crawler_items
  ADD COLUMN IF NOT EXISTS delay_hours   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notified_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notified_by   TEXT,
  ADD COLUMN IF NOT EXISTS publish_after TIMESTAMPTZ;
