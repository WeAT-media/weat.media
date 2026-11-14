-- Параметры источника:
--   delay_hours   — публиковать не раньше чем через N часов после выхода оригинала (дата из RSS; нет — от обнаружения)
--   max_age_hours — брать из ленты только записи моложе N часов (по дате в RSS)
--   link_pattern  — источник без RSS: страница-список, статьи — ссылки того же сайта, чей путь подходит под регулярку
ALTER TABLE crawler_sources
  ADD COLUMN IF NOT EXISTS delay_hours   INT NOT NULL DEFAULT 0 CHECK (delay_hours BETWEEN 0 AND 720),
  ADD COLUMN IF NOT EXISTS max_age_hours INT CHECK (max_age_hours BETWEEN 1 AND 8760),
  ADD COLUMN IF NOT EXISTS link_pattern  TEXT;
