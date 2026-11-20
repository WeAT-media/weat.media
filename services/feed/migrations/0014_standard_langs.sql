-- Документы standard.site без langs сайт показывал русскими: язык по алфавиту текста (как guess_lang в standard.rs); номер после 0013 — 0012 уже занят
UPDATE articles
SET langs = ARRAY[CASE WHEN ((record->>'title') || ' ' || coalesce(record->>'text', '')) ~ '[А-Яа-яЁё]' THEN 'ru' ELSE 'en' END],
    record = jsonb_set(record, '{langs}', to_jsonb(ARRAY[CASE WHEN ((record->>'title') || ' ' || coalesce(record->>'text', '')) ~ '[А-Яа-яЁё]' THEN 'ru' ELSE 'en' END]))
WHERE uri LIKE 'at://%/site.standard.document/%'
  AND (record->'langs' IS NULL OR jsonb_array_length(record->'langs') = 0);
