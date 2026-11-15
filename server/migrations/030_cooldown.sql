-- Период охлаждения: статьи и комментарии 24 ч живут у AppView (видны на сайте), потом уходят в репозиторий
-- автора по заранее выданному rkey (адрес at://… не меняется). Пока ждут — автор правит и удаляет без следа.
CREATE TABLE IF NOT EXISTS pending_records (
  uri         TEXT PRIMARY KEY,                 -- at://did/collection/rkey
  did         TEXT NOT NULL,
  handle      TEXT NOT NULL,
  collection  TEXT NOT NULL,
  rkey        TEXT NOT NULL,
  record      JSONB NOT NULL,
  visible_at  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- выход на сайте (отложенный пост — назначенное время)
  publish_at  TIMESTAMPTZ NOT NULL,                -- в AT: visible_at + 24 ч
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | published | failed
  attempts    INT NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pending_records_due_idx ON pending_records (status, publish_at);
CREATE INDEX IF NOT EXISTS pending_records_did_idx ON pending_records (did, created_at DESC);

-- app-пароль для отложенной публикации (сервер входит им в PDS автора, когда срок вышел)
CREATE TABLE IF NOT EXISTS cooldown_creds (
  did                TEXT PRIMARY KEY,
  app_password_enc   TEXT NOT NULL,
  app_password_name  TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
