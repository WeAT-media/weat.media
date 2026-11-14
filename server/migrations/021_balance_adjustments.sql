-- Ручные корректировки баланса автора (/admin/finance): начисление (+) или списание (−) сотрудником admin.
-- Корректировка сразу доступна к выводу (без окна возвратов) и входит в «Всего заработано».
-- Удалять строки нельзя: ошибочную корректировку исправляют обратной.
CREATE TABLE IF NOT EXISTS balance_adjustments (
  id          TEXT PRIMARY KEY,                          -- adj_<random>
  did         TEXT NOT NULL REFERENCES users (did) ON DELETE RESTRICT,
  amount      INT NOT NULL CHECK (amount <> 0),          -- минимальные единицы валюты, со знаком
  currency    CHAR(3) NOT NULL,
  reason      TEXT NOT NULL,
  created_by  TEXT NOT NULL,                             -- zitadel:<sub> | break-glass
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS balance_adjustments_did_idx ON balance_adjustments (did, created_at DESC);
