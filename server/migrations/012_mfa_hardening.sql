-- Второй фактор нельзя обойти входом напрямую в PDS: токены, выданные после TOTP,
-- отмечаются здесь (sha256), и при включённом TOTP AppView принимает только отмеченные.
CREATE TABLE IF NOT EXISTS mfa_sessions (
  token_hash  TEXT PRIMARY KEY,
  did         TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS mfa_sessions_exp_idx ON mfa_sessions (expires_at);

-- одноразовость mfaToken второго шага входа
CREATE TABLE IF NOT EXISTS mfa_used_tokens (
  token_hash  TEXT PRIMARY KEY,
  expires_at  TIMESTAMPTZ NOT NULL
);

-- повтор кода TOTP и перебор: счётчик неудач на аккаунт, а не на mfaToken
ALTER TABLE user_mfa ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;
ALTER TABLE user_mfa ADD COLUMN IF NOT EXISTS failures INT NOT NULL DEFAULT 0;
ALTER TABLE user_mfa ADD COLUMN IF NOT EXISTS failures_since TIMESTAMPTZ;
ALTER TABLE user_mfa ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
