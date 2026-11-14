-- Совместное редактирование черновика по ссылке (24 ч): документ Yjs — журнал обновлений,
-- рецензенты — все, кто менял текст (остаются у черновика и после истечения ссылки).
CREATE TABLE IF NOT EXISTS shared_drafts (
  token       TEXT PRIMARY KEY,                       -- sd_<random>, в адресе /shared-draft/<token>
  draft_id    TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  owner_did   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS shared_drafts_draft_idx ON shared_drafts (draft_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS shared_draft_updates (
  token       TEXT NOT NULL REFERENCES shared_drafts(token) ON DELETE CASCADE,
  seq         BIGSERIAL,
  did         TEXT NOT NULL,
  data        BYTEA NOT NULL,                         -- Yjs update
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (token, seq)
);

CREATE TABLE IF NOT EXISTS draft_reviewers (
  draft_id    TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  did         TEXT NOT NULL,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, did)
);
