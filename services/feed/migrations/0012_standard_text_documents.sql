-- Offprint и другие Standard-публикации могут хранить только textContent, без content.$type.
-- Отдельный виртуальный тип позволяет включать такие документы, сохраняя фильтр длины и блок-лист.
INSERT INTO standard_platforms (content_type, name, url) VALUES
    ('site.standard.text', 'Offprint / Standard.site', 'https://offprint.app')
ON CONFLICT (content_type) DO NOTHING;
