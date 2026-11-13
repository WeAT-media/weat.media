#!/usr/bin/env bash
# Реплика базы Zitadel: NL-1 (primary) -> RU-1 (standby). Секреты — из .env стека (одинаковый на обоих узлах).
#
#   на NL-1:  ./replica.sh primary            # пользователь replicator, порт 5433 (TLS)
#   на RU-1:  ./replica.sh standby <ip NL-1>  # пустой том -> pg_basebackup, дальше поток WAL
#             ./replica.sh status
#   авария:   ./replica.sh promote            # на RU-1: база принимает запись, стартуют Zitadel и Login UI
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
: "${REPLICATION_PASSWORD:?в .env стека нет REPLICATION_PASSWORD}"
base="-f docker-compose.yml -f docker-compose.node.yml"

case "${1:-}" in
  primary)
    docker compose $base -f docker-compose.primary.yml up -d zitadel-db
    sleep 5
    docker compose $base exec -T zitadel-db psql -U zitadel -d zitadel -X -q -v ON_ERROR_STOP=1 -v pw="$REPLICATION_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE replicator LOGIN REPLICATION PASSWORD %L', :'pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replicator') \gexec
SELECT format('ALTER ROLE replicator LOGIN REPLICATION PASSWORD %L', :'pw') \gexec
SELECT 'SELECT pg_create_physical_replication_slot(''zitadel_ru1'')'
  WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'zitadel_ru1') \gexec
SQL
    echo "primary готов: порт 5433, слот zitadel_ru1"
    ;;

  standby)
    host="${2:?адрес primary (NL-1)}"
    docker compose $base -f docker-compose.standby.yml stop zitadel-api zitadel-login zitadel-db 2>/dev/null || true
    # каталог данных — копия primary; слот держит WAL, пока резерв не догонит
    docker compose $base -f docker-compose.standby.yml run --rm --no-deps -e PGPASSWORD="$REPLICATION_PASSWORD" --entrypoint sh zitadel-db -c "
      set -e
      rm -rf /var/lib/postgresql/data/* /var/lib/postgresql/data/.[!.]* 2>/dev/null || true
      pg_basebackup -h $host -p 5433 -U replicator -D /var/lib/postgresql/data -X stream -S zitadel_ru1 -R -P \
        -d 'sslmode=require'
      chown -R postgres:postgres /var/lib/postgresql/data && chmod 700 /var/lib/postgresql/data"
    docker compose $base -f docker-compose.standby.yml up -d zitadel-db
    echo "standby запущен: ./replica.sh status"
    ;;

  status)
    docker compose $base exec -T zitadel-db psql -U zitadel -d zitadel -X -c \
      "SELECT pg_is_in_recovery() AS standby, now() - pg_last_xact_replay_timestamp() AS lag, status, sender_host FROM pg_stat_wal_receiver RIGHT JOIN (SELECT 1) x ON true"
    ;;

  promote)
    docker compose $base exec -T zitadel-db psql -U zitadel -d zitadel -X -c "SELECT pg_promote()"
    docker compose $base up -d zitadel-api zitadel-login
    echo "Zitadel на этом узле принимает вход. Дальше: auth.weat.media -> этот узел (Gcore)."
    echo "Старый primary после возвращения — только как новый standby (./replica.sh standby <ip>), не запускать как primary."
    ;;

  *)
    sed -n '2,9p' "$0"; exit 1 ;;
esac
