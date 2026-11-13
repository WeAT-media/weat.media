#!/bin/sh
# Инициализация primary (выполняется initdb при первом старте пустого volume):
# роль репликации + pg_hba для внутренней docker-сети.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE ${REPL_USER} WITH REPLICATION LOGIN PASSWORD '${REPL_PASSWORD}';
  -- синхронный standby по application_name=ru2 включается здесь (ALTER SYSTEM),
  -- а не в command: bootstrap с уже включённым sync-режимом зависал бы на
  -- CREATE DATABASE, ожидая ещё не подключённый standby.
  ALTER SYSTEM SET synchronous_standby_names = 'FIRST 1 (ru2)';
SQL

# репликация разрешена только из внутренней сети стенда (production: адреса standby-хостов)
echo "host replication ${REPL_USER} 0.0.0.0/0 scram-sha-256" >> "$PGDATA/pg_hba.conf"
