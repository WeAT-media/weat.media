-- Перенос статей краулера автору по одобренной заявке: копия в репозитории автора, оригинал у краулера
-- скрывается из ленты, а его адрес ведёт на копию (old_uri → new_uri).
CREATE TABLE IF NOT EXISTS claim_transfers (
  old_uri    TEXT PRIMARY KEY,
  new_uri    TEXT NOT NULL,
  claim_id   TEXT NOT NULL REFERENCES ownership_claims (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
