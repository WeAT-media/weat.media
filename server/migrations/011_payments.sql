-- Заказы через lava.top. Вебхук не несёт наших полей — связь «платёж → читатель и статья»
-- хранится здесь по contract_id, который lava.top возвращает при создании счёта.
CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,                         -- ord_<random>
  contract_id   TEXT UNIQUE,                              -- id контракта lava.top
  provider      TEXT NOT NULL DEFAULT 'lava',
  reader_did    TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  content_id    TEXT NOT NULL REFERENCES paid_content (id) ON DELETE RESTRICT,
  author_did    TEXT NOT NULL,
  amount        INT NOT NULL CHECK (amount > 0),           -- минимальные единицы валюты
  currency      CHAR(3) NOT NULL,
  author_share  INT NOT NULL,                              -- 90% автору
  platform_fee  INT NOT NULL,                              -- 10% площадке
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS orders_reader_idx ON orders (reader_did);
CREATE INDEX IF NOT EXISTS orders_author_idx ON orders (author_did, status);
