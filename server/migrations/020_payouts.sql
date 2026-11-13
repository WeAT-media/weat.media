-- Выплаты авторам. Заработано = доля автора в оплаченных заказах (orders.author_share);
-- заявка резервирует сумму сразу, сотрудник отмечает выплату или отклоняет (резерв снимается).
-- Реквизиты — снимок на момент заявки, зашифрованы SECRETS_KEY: номер карты/счёта не лежит открыто.
CREATE TABLE IF NOT EXISTS payouts (
  id               TEXT PRIMARY KEY,                     -- po_<random>
  author_did       TEXT NOT NULL REFERENCES users (did) ON DELETE RESTRICT,
  amount           INT NOT NULL CHECK (amount > 0),      -- минимальные единицы валюты
  currency         CHAR(3) NOT NULL,
  method           TEXT NOT NULL CHECK (method IN ('fiat', 'crypto')),
  destination_enc  TEXT NOT NULL,
  destination_hint TEXT NOT NULL,                        -- «•••• 4242» для списков
  status           TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'paid', 'rejected')),
  staff_note       TEXT,
  decided_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payouts_author_idx ON payouts (author_did, created_at DESC);
CREATE INDEX IF NOT EXISTS payouts_status_idx ON payouts (status, created_at);
