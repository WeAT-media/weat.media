-- Раньше publishAt означал уход в AT, а на сайте запись появлялась за сутки до него.
-- Сохраняем выбранное автором время как выход на сайте и добавляем полные сутки охлаждения.
UPDATE pending_records
SET visible_at = publish_at,
    publish_at = publish_at + interval '24 hours',
    updated_at = now()
WHERE status = 'pending'
  AND collection = 'media.weat.article'
  AND record->>'createdAt' IS NOT NULL
  AND (record->>'createdAt')::timestamptz = publish_at;
