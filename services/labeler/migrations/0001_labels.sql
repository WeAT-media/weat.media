-- Метки коллегий: подписанные записи com.atproto.label.defs#label. seq — общий курсор subscribeLabels.
-- Снятие метки — новая запись с neg = true (история не переписывается).
CREATE TABLE IF NOT EXISTS labels (
  seq   BIGSERIAL PRIMARY KEY,
  src   TEXT NOT NULL,            -- DID коллегии (did:web:<id>.justice.weat.media)
  uri   TEXT NOT NULL,            -- at://… или did:… — на что метка
  cid   TEXT,                     -- версия записи (необязательно)
  val   TEXT NOT NULL,            -- значение метки, напр. verdict.broken-code
  neg   BOOLEAN NOT NULL DEFAULT false,
  cts   TEXT NOT NULL,            -- время создания, ISO-8601 — ровно та строка, что подписана
  sig   BYTEA NOT NULL,           -- secp256k1, 64 байта, low-S
  actor TEXT                      -- кто поставил: сотрудник (zitadel:<sub>) — в подпись не входит
);
CREATE INDEX IF NOT EXISTS labels_uri_idx ON labels (uri, src, seq DESC);
CREATE INDEX IF NOT EXISTS labels_src_seq_idx ON labels (src, seq);
