-- Аватар: сам файл — blob на PDS, ссылка — в app.bsky.actor.profile; здесь CID для быстрой выдачи профиля.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_cid TEXT;
