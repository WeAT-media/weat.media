-- TOTP проверяет AppView; email-2FA живёт в PDS (emailAuthFactor)
CREATE TABLE IF NOT EXISTS user_mfa (
  did                 TEXT PRIMARY KEY REFERENCES users (did) ON DELETE CASCADE,
  -- секрет зашифрован SECRETS_KEY; pending — до подтверждения первым кодом
  totp_secret_enc     TEXT,
  totp_pending_enc    TEXT,
  totp_enabled_at     TIMESTAMPTZ,
  -- sha256 неиспользованных резервных кодов
  backup_code_hashes  TEXT[] NOT NULL DEFAULT '{}',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
