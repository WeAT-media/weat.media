-- Платные статьи: в AT-репозиторий автора (он публичен) уходит только обложка с тизером,
-- полный текст — здесь, зашифрованный PAID_CONTENT_KEY, выдаётся после проверки доступа.
CREATE TABLE IF NOT EXISTS paid_content (
  id            TEXT PRIMARY KEY,                 -- pc_<random>
  author_did    TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  at_uri        TEXT UNIQUE,                      -- публичная обложка в репозитории автора
  title         TEXT NOT NULL,
  body_enc      TEXT NOT NULL,                    -- AES-256-GCM (secretbox)
  access_type   TEXT NOT NULL CHECK (access_type IN ('one-time', 'subscription')),
  price         INT NOT NULL DEFAULT 0 CHECK (price >= 0),  -- минимальные единицы валюты
  currency      CHAR(3) NOT NULL DEFAULT 'RUB',
  tier_id       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paid_content_author_idx ON paid_content (author_did);

-- Право доступа: покупка статьи или подписка на тариф автора
CREATE TABLE IF NOT EXISTS entitlements (
  id            BIGSERIAL PRIMARY KEY,
  reader_did    TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  content_id    TEXT REFERENCES paid_content (id) ON DELETE CASCADE,   -- покупка статьи
  author_did    TEXT,                                                  -- подписка на автора
  tier_id       TEXT,
  source        TEXT NOT NULL CHECK (source IN ('purchase', 'subscription', 'grant')),
  -- внешний платёж (lava.top): идемпотентность webhook'ов
  payment_ref   TEXT UNIQUE,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  CHECK (content_id IS NOT NULL OR author_did IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS entitlements_reader_idx ON entitlements (reader_did);
