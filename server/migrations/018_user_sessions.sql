-- Журнал устройств: каждая выданная пара токенов PDS — сессия. Храним только хеши токенов, не сами токены;
-- вместо IP — страна. При обновлении сессия та же: хеши заменяются новыми (refresh ротируется).
-- revoked_at — сессия завершена (пользователем или сотрудником): её токены сервер больше не принимает.
CREATE TABLE IF NOT EXISTS user_sessions (
  id            TEXT PRIMARY KEY,                       -- ses_<random>
  did           TEXT NOT NULL,
  access_hash   TEXT NOT NULL,
  refresh_hash  TEXT NOT NULL,
  device        TEXT NOT NULL,                          -- «Safari · macOS»
  country       TEXT NOT NULL,                          -- ISO по IP входа
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  revoked_by    TEXT                                    -- 'user' | sub сотрудника | 'break-glass'
);
CREATE INDEX IF NOT EXISTS user_sessions_did_idx ON user_sessions (did, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS user_sessions_access_idx ON user_sessions (access_hash);
CREATE INDEX IF NOT EXISTS user_sessions_refresh_idx ON user_sessions (refresh_hash);
