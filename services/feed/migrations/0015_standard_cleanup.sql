-- site.standard.text (документы без content.$type) открыл ленту всей сети: мосты brid.gy с чужих сайтов,
-- в том числе NSFW, и новостные боты. Выключаем; такие документы — только от авторов из белого списка.
UPDATE standard_platforms SET enabled = false WHERE content_type = 'site.standard.text';

DELETE FROM articles
WHERE uri LIKE 'at://%/site.standard.document/%'
  AND did NOT IN (SELECT did FROM standard_allow)
  AND (
    record->>'platform' = 'site.standard.text'
    OR record->>'platform' IS NULL
    -- SEO-фермы: те же признаки, что spam_title в standard.rs
    OR lower(record->>'title') ~ '(dumps|braindump|exam questions|exam prep|exam guide|practice questions|practice test|study guide|study materials|certification exam|certification guide|dofollow|backlinks|pdf questions)'
    OR (lower(record->>'title') LIKE '%exam%' AND lower(record->>'title') ~ '(pdf|2026|updated)')
  );
