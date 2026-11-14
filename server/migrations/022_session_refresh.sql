-- Отзыв сессии и в самом PDS: refresh-токен хранится зашифрованным (SECRETS_KEY) и при завершении
-- сессии уходит в com.atproto.server.deleteSession — обновить украденную пару в обход сайта нельзя.
-- У старых сессий значения нет: они отзываются, как раньше, только на стороне AppView.
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS refresh_enc TEXT;
