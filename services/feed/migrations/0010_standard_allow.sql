-- Авторы site.standard.document (standard.site: Leaflet, pckt и др.), чьи документы попадают в ленту.
-- Сеть читается целиком через Jetstream, но в индекс — только DID из этого списка (ведут админы).
CREATE TABLE standard_allow (
    did TEXT PRIMARY KEY,
    note TEXT,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- история автора догружена с его PDS; NULL — догрузить при следующем проходе
    backfilled_at TIMESTAMPTZ
);
