-- С площадок — только авторы со своим доменом: издания на leaflet.pub (*.leaflet.pub) заводят фермы.
-- Как own_domain в standard.rs: source.site — домен адреса оригинала; авторы из белого списка не трогаем.
DELETE FROM articles
WHERE uri LIKE 'at://%/site.standard.document/%'
  AND did NOT IN (SELECT did FROM standard_allow)
  AND (
    record->'source'->>'url' IS NULL
    OR lower(record->'source'->>'site') = 'leaflet.pub'
    OR lower(record->'source'->>'site') LIKE '%.leaflet.pub'
  );
