-- Заявки «я автор оригинала»: на автора источника (сайт + автор), а не на всё, что собрал краулер.
-- Один заявитель получает только статьи своего автора; повторная заявка на того же автора не создаётся.
CREATE TABLE IF NOT EXISTS ownership_claims (
  id                 TEXT PRIMARY KEY,                -- cl_<random>
  claimant_did       TEXT NOT NULL REFERENCES users (did) ON DELETE CASCADE,
  crawler_did        TEXT NOT NULL,                   -- чей репозиторий хранит копии
  source_site        TEXT NOT NULL,                   -- habr.com
  source_author      TEXT NOT NULL,                   -- ник на сайте
  source_author_url  TEXT,
  article_uri        TEXT NOT NULL,                   -- статья, с которой подана заявка
  code               TEXT NOT NULL,                   -- разместить в профиле на сайте
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'transferred')),
  note               TEXT,                            -- пояснение заявителя
  decision_note      TEXT,                            -- причина решения сотрудника
  decided_by         TEXT,
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- один активный автор источника — у одного заявителя
CREATE UNIQUE INDEX IF NOT EXISTS ownership_claims_author_idx
  ON ownership_claims (source_site, lower(source_author)) WHERE status IN ('pending', 'approved', 'transferred') ;
CREATE INDEX IF NOT EXISTS ownership_claims_claimant_idx ON ownership_claims (claimant_did);
CREATE INDEX IF NOT EXISTS ownership_claims_status_idx ON ownership_claims (status, created_at);
