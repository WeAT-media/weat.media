-- Согласие на обработку персональных данных (152-ФЗ, ст. 9): когда и на какую редакцию документов.
-- Согласие — отдельный документ (/legal/consent), принимается отдельной отметкой при регистрации.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pd_consent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pd_consent_version TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;
