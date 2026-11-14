-- Системные учётки площадки (news, crawler, justice и созданные админом): пароль PDS зашифрован SECRETS_KEY,
-- людям не показывается. Сотрудник admin входит в учётку из админки («Войти как») — каждый вход в журнале.
CREATE TABLE IF NOT EXISTS system_accounts (
  did          TEXT PRIMARY KEY REFERENCES users (did) ON DELETE CASCADE,
  password_enc TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
