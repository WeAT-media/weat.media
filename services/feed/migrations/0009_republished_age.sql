-- Перепечатка автором (source без crawledAt) — новая публикация на площадке: возраст для ранжирования
-- от created_at, а не от даты оригинала (иначе не попадала в «Горячее»). Записи краулера не трогаем.
UPDATE articles SET published_at = created_at
WHERE record ? 'source'
  AND NOT (record -> 'source') ? 'crawledAt'
  AND published_at <> created_at;
