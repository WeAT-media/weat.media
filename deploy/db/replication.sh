#!/usr/bin/env bash
# Логическая репликация Postgres внутри контура: primary -> standby.
# Physical streaming невозможен: Yandex Managed PostgreSQL и Supabase не принимают
# чужие физические реплики, поэтому publication/subscription.
#
#   PRIMARY_DSN=postgres://...  ./replication.sh publish     # на primary, один раз
#   STANDBY_DSN=postgres://... PRIMARY_DSN=... ./replication.sh subscribe
#   STANDBY_DSN=... ./replication.sh status
#   STANDBY_DSN=... ./replication.sh promote                # переключение на резерв
#
# Перед subscribe на standby должна быть схема: запустите AppView на standby один раз
# (он применит миграции и создаст пустые таблицы), затем подписка скопирует данные.
#
# Требования по площадкам:
#   Yandex MPG: пользователю роль mdb_replication; в настройках кластера wal_level=logical.
#   Supabase:   подписка требует роли pg_create_subscription (PG16+) — проверьте у проекта;
#               подключение напрямую к БД (порт 5432), не через transaction-pooler.
#   свой PG:    compose уже запускает с wal_level=logical.
set -euo pipefail

PUB=indie_pub
SUB=indie_sub
# schema_migrations не реплицируем: AppView на standby пишет туда свои строки
TABLES="users, user_settings, identities, user_mfa, paid_content, entitlements, personal_tokens, oauth_clients, orders"

psql_q() { psql "$1" -v ON_ERROR_STOP=1 -X -q -c "$2"; }

case "${1:-}" in
  publish)
    : "${PRIMARY_DSN:?PRIMARY_DSN}"
    psql_q "$PRIMARY_DSN" "DO \$\$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = '$PUB') THEN
        CREATE PUBLICATION $PUB FOR TABLE $TABLES;
      END IF; END \$\$;"
    psql "$PRIMARY_DSN" -X -c "SELECT pubname, tablename FROM pg_publication_tables WHERE pubname = '$PUB'"
    ;;

  add-table)
    # новая таблица после миграции: ./replication.sh add-table <имя> (на primary, затем refresh на standby)
    : "${PRIMARY_DSN:?PRIMARY_DSN}" "${2:?имя таблицы}"
    psql_q "$PRIMARY_DSN" "ALTER PUBLICATION $PUB ADD TABLE $2"
    echo "теперь на standby: STANDBY_DSN=... $0 refresh"
    ;;

  subscribe)
    : "${STANDBY_DSN:?STANDBY_DSN}" "${PRIMARY_DSN:?PRIMARY_DSN}"
    psql_q "$STANDBY_DSN" "CREATE SUBSCRIPTION $SUB CONNECTION '$PRIMARY_DSN' PUBLICATION $PUB WITH (copy_data = true)"
    echo "подписка создана, начальная копия идёт: $0 status"
    ;;

  refresh)
    : "${STANDBY_DSN:?STANDBY_DSN}"
    psql_q "$STANDBY_DSN" "ALTER SUBSCRIPTION $SUB REFRESH PUBLICATION"
    ;;

  status)
    : "${STANDBY_DSN:?STANDBY_DSN}"
    psql "$STANDBY_DSN" -X -c "SELECT subname, pid IS NOT NULL AS running, received_lsn, latest_end_lsn, latest_end_time,
      now() - latest_end_time AS lag FROM pg_stat_subscription WHERE subname = '$SUB'"
    psql "$STANDBY_DSN" -X -c "SELECT srrelid::regclass AS table, srsubstate AS state FROM pg_subscription_rel"
    ;;

  promote)
    # standby становится primary: останавливаем подписку и выравниваем счётчики.
    # Если старый primary недоступен, слот на нём не удалить — отвязываемся от него (slot_name = NONE).
    : "${STANDBY_DSN:?STANDBY_DSN}"
    psql_q "$STANDBY_DSN" "ALTER SUBSCRIPTION $SUB DISABLE"
    psql_q "$STANDBY_DSN" "ALTER SUBSCRIPTION $SUB SET (slot_name = NONE)"
    psql_q "$STANDBY_DSN" "DROP SUBSCRIPTION $SUB"
    # логическая репликация не переносит значения последовательностей
    psql_q "$STANDBY_DSN" "DO \$\$ DECLARE r record; BEGIN
      FOR r IN
        SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
        FROM pg_class s
        JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
        JOIN pg_class t ON t.oid = d.refobjid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        WHERE s.relkind = 'S'
      LOOP
        EXECUTE format('SELECT setval(%L, COALESCE((SELECT max(%I) FROM %I), 0) + 1, false)', r.seq, r.col, r.tbl);
      END LOOP; END \$\$;"
    echo "готово: standby принимает запись. Дальше:"
    echo "  1) NODE_ROLE=primary и COMPOSE_PROFILES=primary в .env узла, docker compose up -d"
    echo "  2) восстановить PDS из копии: docker compose run --rm pds-backup restore (deploy/pds-backup)"
    echo "  3) переключить GeoDNS weat.media своего контура на этот узел"
    ;;

  *)
    sed -n '2,20p' "$0"
    exit 1
    ;;
esac
