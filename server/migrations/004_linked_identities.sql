ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_provider_check;
ALTER TABLE identities
  ADD CONSTRAINT identities_provider_check CHECK (provider IN ('yandex', 'google', 'github', 'telegram'));

-- что показать в настройках: логин/email у провайдера
ALTER TABLE identities ADD COLUMN IF NOT EXISTS display TEXT;
-- имя app password в PDS (для отзыва при отвязке); NULL — хранится основной пароль PDS
ALTER TABLE identities ADD COLUMN IF NOT EXISTS app_password_name TEXT;

-- у пользователя есть пароль, который он знает (регистрация по email); у Яндекс-регистрации — нет
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_login BOOLEAN NOT NULL DEFAULT true;
UPDATE users SET password_login = false
WHERE did IN (SELECT did FROM identities WHERE app_password_name IS NULL);
