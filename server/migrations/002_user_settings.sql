CREATE TABLE IF NOT EXISTS user_settings (
  did         TEXT PRIMARY KEY REFERENCES users (did) ON DELETE CASCADE,
  -- разделы настроек верхнего уровня (prefs, editorPrefs, labelers, ...), схема — server/src/settings.ts
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
