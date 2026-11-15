CREATE TABLE IF NOT EXISTS author_subscriptions (
  subscriber_did TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  author_did     TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_did, author_did),
  CHECK (subscriber_did <> author_did)
);

CREATE INDEX IF NOT EXISTS author_subscriptions_author_idx ON author_subscriptions (author_did);

CREATE TABLE IF NOT EXISTS notifications (
  id            BIGSERIAL PRIMARY KEY,
  recipient_did TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('article', 'comment', 'reply')),
  actor_did     TEXT NOT NULL,
  actor_handle  TEXT NOT NULL,
  subject_uri   TEXT NOT NULL,
  article_uri   TEXT NOT NULL,
  article_title TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ,
  UNIQUE (recipient_did, kind, subject_uri)
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (recipient_did, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (recipient_did, id) WHERE read_at IS NULL;
