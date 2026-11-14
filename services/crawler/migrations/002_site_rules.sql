-- Правила разбора сайтов (как Telegram Instant View, src/rules.ts): по хосту без www.
-- Есть правила и путь подходит — статья извлекается по ним, иначе встроенный разборщик.
CREATE TABLE IF NOT EXISTS site_rules (
  host        TEXT PRIMARY KEY,           -- blog-vitaliharadkou.vercel.app
  rules       TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
