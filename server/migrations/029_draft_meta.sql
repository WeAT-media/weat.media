-- Настройки публикации черновика (шаг 2 редактора: подзаголовок, теги, язык, видео, платный доступ и т. д.)
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
