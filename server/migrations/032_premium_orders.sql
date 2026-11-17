-- Premium за деньги: разовый счёт lava.top на 30 дней (продукт «цена по запросу API» — без автопродления).
-- Отдельно от orders: там content_id ссылается на платную статью и участвует в балансе автора.
CREATE TABLE IF NOT EXISTS premium_orders (
  id           TEXT PRIMARY KEY,                          -- prm_<random>
  contract_id  TEXT UNIQUE,                               -- id контракта lava.top
  did          TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  amount       INT NOT NULL CHECK (amount > 0),            -- копейки
  currency     CHAR(3) NOT NULL,
  days         INT NOT NULL CHECK (days > 0),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at      TIMESTAMPTZ,
  paid_until   TIMESTAMPTZ                                -- до какого момента продлил Premium
);
CREATE INDEX IF NOT EXISTS premium_orders_did ON premium_orders (did, paid_until DESC);
