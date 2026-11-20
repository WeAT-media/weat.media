-- Фермы обошли первые признаки («Get Ready for the … Exam with Effective Practice»): те же расширенные
-- признаки, что spam_title в standard.rs, для уже попавших документов. Авторы из белого списка не трогаем.
DELETE FROM articles
WHERE uri LIKE 'at://%/site.standard.document/%'
  AND did NOT IN (SELECT did FROM standard_allow)
  AND lower(record->>'title') LIKE '%exam%'
  AND (
    lower(record->>'title') ~ '(pdf|2026|updated|practice|prep|get ready|pass |questions|materials|guide|certif|resources)'
    OR (record->>'title') ~ '\m[A-Z0-9]+[-_][A-Z0-9-]*[0-9][A-Z0-9-]*\M'
  );
