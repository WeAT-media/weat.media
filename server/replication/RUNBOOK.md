# Репликация PostgreSQL для Indie.media — runbook

Топология production: **RU-1** (Yandex Cloud, primary), **RU-2** (VPS, синхронный standby,
`application_name=ru2`), **NL** (VPS, асинхронный standby, `application_name=nl`).
Локальный стенд `server/docker-compose.replication.yml` воспроизводит её на трёх
контейнерах `postgres:16-alpine`.

## Локальный стенд

```sh
cd server
cp .env.replication.example .env.replication   # задайте свой REPL_PASSWORD
docker compose --env-file .env.replication -f docker-compose.replication.yml up -d
```

Проверки:

```sh
# primary не в recovery, standby — в recovery
docker exec indie-pg-ru1 psql -U indie -d indie -tc 'SELECT pg_is_in_recovery();'   # f
docker exec indie-pg-ru2 psql -U indie -d indie -tc 'SELECT pg_is_in_recovery();'   # t
docker exec indie-pg-nl psql -U indie -d indie -tc 'SELECT pg_is_in_recovery();'    # t

# состояние репликации на primary: ru2 = sync, nl = async
docker exec indie-pg-ru1 psql -U indie -d indie -c \
  "SELECT application_name, state, sync_state FROM pg_stat_replication ORDER BY application_name;"

# запись на primary видна на обеих репликах; запись на standby запрещена
docker exec indie-pg-ru1 psql -U indie -d indie -c "CREATE TABLE IF NOT EXISTS repl_check(id int); INSERT INTO repl_check VALUES (1);"
docker exec indie-pg-ru2 psql -U indie -d indie -tc 'SELECT count(*) FROM repl_check;'
docker exec indie-pg-nl psql -U indie -d indie -tc 'SELECT count(*) FROM repl_check;'
docker exec indie-pg-ru2 psql -U indie -d indie -c 'INSERT INTO repl_check VALUES (2);'  # ERROR: cannot execute INSERT in a read-only transaction
```

Остановка и полная очистка стенда:

```sh
docker compose -f docker-compose.replication.yml down -v
```

## Production-ограничения (обязательны)

- **Сеть**: репликационный трафик только по приватному WireGuard-каналу между RU-1/RU-2/NL;
  порт 5432 не публикуется наружу, firewall (security groups/iptables) пропускает 5432 лишь
  с адресов реплик. На самой репликации — TLS (`ssl=on`, сертификаты хостов).
- **Синхронный standby RU-2**: `synchronous_standby_names = 'FIRST 1 (ru2)'`. Пока RU-2
  недоступен, коммиты на primary **ждут** — это цена гарантии RPO=0 внутри РФ-контура.
  Деградация в async на время обслуживания RU-2: `ALTER SYSTEM SET synchronous_standby_names = ''; SELECT pg_reload_conf();`, вернуть после.
- **Failover — только ручной и контролируемый**: `pg_ctl promote` на RU-2, переключение
  приложения (`DATABASE_URL`), бывший primary возвращается в строй как standby через
  `pg_rewind` либо свежий `pg_basebackup`. Автоматический failover не используем: сплит-брейн
  недопустим.
- **Бэкапы/PITR**: ежедневный `pg_basebackup` + непрерывный WAL-архив (`archive_command`,
  напр. wal-g в объектное хранилище Yandex). Реплика — не бэкап: удаления и ошибки
  реплицируются мгновенно. Проверка восстановления — минимум раз в месяц.
- **Мониторинг**: `pg_stat_replication` (lag в байтах), `replay_lag` на standby, алерты на
  отвал sync-реплики.

## NL и персональные данные (ПДн) — зафиксированный риск

Предложенная **физическая** реплика NL содержит **полную копию базы, включая ПДн**
(аккаунты, email, реквизиты выплат). Вынос ПДн за пределы РФ-контура требует
юридической проверки (локализация 242-ФЗ): **NL standby в текущем виде не включается
в production до заключения юриста**.

Предпочтительный production-вариант для NL — **логическая репликация публичного
набора данных** (publication только таблиц публичного контента: статьи/профили без ПДн)
на отдельный NL-инстанс. Это следующий этап; намеренно не реализован здесь частично,
чтобы не создать ложное ощущение готовности.

## Приложение

- Все текущие операции AppView идут на primary (`DATABASE_URL`). Опциональный
  `DATABASE_READ_URL` зарезервирован для будущих read-only запросов ленты; в критичных
  read-after-write путях (auth, настройки, выплаты) он **не используется** — после записи
  читаем всегда primary.
