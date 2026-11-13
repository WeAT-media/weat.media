-- Журнал действий сотрудников: кто (sub в Zitadel или break-glass), что, над чем
CREATE TABLE IF NOT EXISTS admin_audit (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,              -- zitadel:<sub> | break-glass
  actor_name TEXT,
  action     TEXT NOT NULL,              -- user.tier, entitlement.grant, …
  target     TEXT,
  details    JSONB,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_at_idx ON admin_audit (at DESC);
