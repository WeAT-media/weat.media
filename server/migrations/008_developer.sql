-- Разработчикам: персональные токены (публикация через API) и OAuth-приложения («Войти через weat.media»).
-- Сами токены и секреты не храним — только sha256; показываются пользователю один раз.

CREATE TABLE IF NOT EXISTS personal_tokens (
  id                 TEXT PRIMARY KEY,                -- pat_<random>, публичный идентификатор
  did                TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  token_hash         TEXT NOT NULL UNIQUE,            -- sha256(wm_pat_…)
  scopes             TEXT[] NOT NULL,
  -- запись в AT-репозиторий идёт сессией PDS: под токен выпускается отдельный app password
  app_password_name  TEXT NOT NULL,
  app_password_enc   TEXT NOT NULL,                   -- SECRETS_KEY (secretbox)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ,
  last_used_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS personal_tokens_did_idx ON personal_tokens (did);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id      TEXT PRIMARY KEY,                    -- wm_app_<random>
  owner_did      TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  homepage_url   TEXT NOT NULL,
  redirect_uris  TEXT[] NOT NULL,
  secret_hash    TEXT NOT NULL,                       -- sha256(wm_cs_…)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  secret_rotated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_clients_owner_idx ON oauth_clients (owner_did);
