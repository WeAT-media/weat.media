-- Явные SEO-фермы из первой выгрузки Jetstream: серии exam dumps и продажа dofollow-ссылок.
INSERT INTO standard_block (did, note) VALUES
    ('did:plc:ad7ibwr7wo7cgvv7ihxuqvm7', 'SEO-ферма: серия exam dumps'),
    ('did:plc:omvkvmkggq6vtsc2xr2tdacz', 'SEO-ферма: серия exam dumps'),
    ('did:plc:f3sfnosvaqja6a55lxn6p7hj', 'SEO-ферма: серия exam dumps'),
    ('did:plc:sdv53cut6n3gaqrvkmnafvrl', 'SEO-ферма: серия exam dumps'),
    ('did:plc:74sn3xo57zqatytlp6no2zwm', 'SEO-ферма: серия exam dumps'),
    ('did:plc:bkypuqxskyq2xeagbhyk6hqi', 'SEO-ферма: серия exam dumps'),
    ('did:plc:g7vvwdihbzu4puhr6iqgljqo', 'SEO-ферма: серия exam dumps'),
    ('did:plc:halr67zsn2zecpsg2id7vcds', 'SEO-ферма: серия exam dumps'),
    ('did:plc:iv6rdbxtnd5gecxzczx6jpsw', 'SEO-ферма: серия exam dumps'),
    ('did:plc:iufdzrxxk74qqkbc7uxcjmor', 'Продажа dofollow-ссылок')
ON CONFLICT (did) DO UPDATE SET note = EXCLUDED.note;

-- Блок действует и на записи, которые уже успели попасть в индекс до установки правила.
DELETE FROM articles
WHERE uri LIKE 'at://%/site.standard.document/%'
  AND did IN (SELECT did FROM standard_block);
