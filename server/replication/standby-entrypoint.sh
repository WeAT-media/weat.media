#!/bin/sh
# Bootstrap standby: pg_basebackup с primary в пустой PGDATA, затем обычный старт.
# -R пишет standby.signal и primary_conninfo (включая application_name=$APP_NAME).
set -e

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "standby $APP_NAME: ждём primary $PRIMARY_HOST…"
  until PGPASSWORD="$REPL_PASSWORD" pg_isready -h "$PRIMARY_HOST" -U "$REPL_USER" -d postgres; do
    sleep 1
  done
  echo "standby $APP_NAME: pg_basebackup…"
  rm -rf "$PGDATA"/*
  PGPASSWORD="$REPL_PASSWORD" pg_basebackup \
    -h "$PRIMARY_HOST" -p 5432 -U "$REPL_USER" \
    -D "$PGDATA" -R -X stream -P \
    -d "application_name=$APP_NAME"
  chmod 700 "$PGDATA"
fi

exec docker-entrypoint.sh postgres -c hot_standby=on
