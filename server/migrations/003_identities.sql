-- Внешние провайдеры входа (Яндекс ID). У таких аккаунтов нет пароля, известного
-- пользователю: AppView генерирует пароль PDS и хранит его зашифрованным (AES-256-GCM).
CREATE TABLE IF NOT EXISTS identities (
  provider          TEXT NOT NULL CHECK (provider IN ('yandex')),
  provider_user_id  TEXT NOT NULL,
  did               TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  pds_password_enc  TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS identities_did_idx ON identities (did);
