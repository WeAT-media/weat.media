ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_provider_check;
ALTER TABLE identities
  ADD CONSTRAINT identities_provider_check CHECK (provider IN ('yandex', 'google', 'github', 'telegram', 'atproto'));
