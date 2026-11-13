-- Откуда пришёл пользователь: первая UTM-метка (first touch), с которой он попал на сайт до регистрации
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_utm JSONB;
