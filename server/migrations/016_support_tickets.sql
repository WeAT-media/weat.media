-- Обращения в поддержку и запросы органов. Документ (паспорт, ВНЖ) сюда не загружается — только его метаданные:
-- сам файл сотрудник запрашивает отдельным защищённым каналом.
CREATE TABLE IF NOT EXISTS support_tickets (
  id            TEXT PRIMARY KEY,                       -- tk_<random>
  kind          TEXT NOT NULL CHECK (kind IN ('support', 'legal')),
  category      TEXT NOT NULL,
  email         TEXT NOT NULL,
  did           TEXT,                                   -- если писал вошедший пользователь
  handle        TEXT,                                   -- как указал сам
  article_url   TEXT,
  subject       TEXT NOT NULL,
  message       TEXT NOT NULL,
  country_from  TEXT,
  country_to    TEXT,
  doc_type      TEXT,
  doc_meta      JSONB,                                  -- { name, size, type }
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'waiting', 'resolved', 'rejected')),
  staff_note    TEXT,                                   -- внутренняя заметка сотрудника
  updated_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets (status, created_at DESC);
