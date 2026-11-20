-- Площадки standard.site целиком: документы с таким content.$type идут в ленту без белого списка авторов.
-- Сеть открыта, спам есть — отдельных авторов можно заблокировать (standard_block).
CREATE TABLE standard_platforms (
    content_type TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- поток перемотан на сутки назад, чтобы лента сразу получила свежие документы площадки; NULL — перемотать
    backfilled_at TIMESTAMPTZ
);

INSERT INTO standard_platforms (content_type, name, url) VALUES
    ('pub.leaflet.content', 'Leaflet', 'https://leaflet.pub'),
    ('blog.pckt.content', 'pckt', 'https://pckt.blog'),
    ('app.offprint.content', 'Offprint', 'https://offprint.app');

CREATE TABLE standard_block (
    did TEXT PRIMARY KEY,
    note TEXT,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
