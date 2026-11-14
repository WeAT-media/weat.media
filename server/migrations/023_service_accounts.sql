-- Служебные учётки площадки (коллегии присяжных — лейблеры и т. п.): не люди, а службы.
-- service — роль учётки ('labeler'); NULL — обычный пользователь. В /admin/users — отдельный фильтр.
ALTER TABLE users ADD COLUMN IF NOT EXISTS service TEXT;
CREATE INDEX IF NOT EXISTS users_service_idx ON users (service) WHERE service IS NOT NULL;
