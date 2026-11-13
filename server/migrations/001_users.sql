CREATE TABLE IF NOT EXISTS users (
  did              TEXT PRIMARY KEY,
  handle           TEXT NOT NULL UNIQUE,
  display_name     TEXT,
  -- ISO 3166-1 alpha-2 по GeoIP в момент регистрации; 'ZZ' = не определена
  signup_country   CHAR(2) NOT NULL,
  tier             TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'premium')),
  premium_since    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_handle_lower_idx ON users (lower(handle));
