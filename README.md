# weAT.media

Открытая читательская площадка поверх [AT Protocol](https://atproto.com): статьи живут в репозиториях
авторов, площадка лишь собирает ленту. Ни площадка, ни модератор не могут удалить работу автора — спорные
вердикты выносят коллегии присяжных подписанными метками.

Лицензия — [AGPL-3.0-or-later](LICENSE). Разворачивайте свою инсталляцию: если вы меняете код и даёте
сервис людям, откройте свои изменения. Ссылка на исходники уже есть в подвале сайта (`VITE_SOURCE_URL`).

## Что внутри

| Каталог | Что это |
|---|---|
| `src/` | Фронтенд (React + Vite, редактор BlockSuite) |
| `server/` | AppView (Hono): аккаунты на своём PDS, вход (пароль, Яндекс ID, AT OAuth, Google, GitHub, Telegram), 2FA, настройки, OpenAPI на `/api` |
| `services/feed/` | Лента (Rust): индекс статей, комментариев и лайков по потоку событий PDS, открытое ранжирование (`src/rank.rs`) |
| `services/analytics/` | Открытая аналитика (Rust): дневные агрегаты без IP и cookie, досмотры видео |
| `services/crawler/` | Краулер: переносит статьи из внешних источников в AT-репозитории аккаунтов-краулеров (очереди BullMQ) |
| `lexicons/` | Форматы записей: `media.weat.article`, `media.weat.comment`, `media.weat.like` |
| `deploy/` | Развёртывание: узел, вход сотрудников (`auth`), репликация БД, резервное копирование PDS, DNS-зона |

## Вход: читатели и сотрудники

Площадка одна, а входа два — намеренно:

- **Читатели и авторы** входят в свой AT-аккаунт на PDS (пароль, Яндекс ID, Google, GitHub, Telegram, чужой PDS —
  всё это подключает `server/`). Сессия — токен PDS: им пишутся статьи, комментарии и лайки в репозиторий
  пользователя. Аккаунт принадлежит пользователю, а не площадке: уйдёт на другой PDS — заберёт его с собой.
- **Сотрудники** (поддержка, модерация, админы) входят через Zitadel (`deploy/auth`, `auth.weat.media`): роли
  `support`, `moderator`, `admin`, 2FA и журнал входов. `server/` проверяет токен Zitadel и роль на каждом
  `/admin/*` (`requireStaff`), все действия пишутся в аудит.

Общий вход через Zitadel для всех сделал бы площадку хозяином всех учёток (серверу пришлось бы хранить доступ к
PDS каждого пользователя) — от этого площадка и уходит. Единой её делают общий домен и общий интерфейс:
админка — это `weat.media/admin/*` в том же приложении. Сотрудник, который ещё и автор, входит дважды — как
сотрудник и как автор; это разные роли, и в аудите они не смешиваются.

## Разработка

Нужны Node 24, pnpm 10, Docker.

```bash
pnpm install
cd server && cp .env.example .env && cp .env.pds.example .env.pds   # заполнить секреты
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d  # Postgres, PDS, PLC, Mailpit, Redis
pnpm install && pnpm dev                                              # AppView на :8787
pnpm seed:demo                                                        # user / premium, пароль demo12345
cd .. && pnpm dev                                                     # сайт на http://localhost:3000
```

Письма (коды 2FA, сброс пароля) в разработке смотрите в Mailpit: http://localhost:8025.

Тесты: `cd server && pnpm test`, `cd services/crawler && pnpm test`.

## Своя инсталляция (один узел)

1. Соберите образы, задав свой бренд и домен:
   ```bash
   docker build -f deploy/node/Dockerfile.edge -t my-edge \
     --build-arg VITE_SITE_NAME="My Media" --build-arg VITE_HANDLE_DOMAIN=example.org .
   docker build -t my-appview server/
   ```
2. `cp deploy/node/.env.example deploy/node/.env` и `.env.pds.example` → `.env.pds`. Для одного узла:
   `CONTOUR=global`, `NODE_ROLE=primary`, `PEER_CONTOUR_URL` пустой.
3. DNS по шаблону `deploy/dns.zone.example` (без GeoDNS — обычные A-записи).
4. `cd deploy/node && docker compose --profile selfhosted-db up -d`.

Переменные бренда — в `.env.example` в корне.

## Несколько узлов и контуры

Один адрес для всех через GeoDNS; персональные данные российских пользователей хранятся в РФ-контуре
(242-ФЗ), публичные статьи общие. Узел-резерв в каждом контуре: логическая репликация Postgres
(`deploy/db/replication.sh`) и копия PDS в S3 (`deploy/pds-backup`). Подробности — в комментариях
`deploy/node/docker-compose.yml`.

## Участие

Issues и pull requests приветствуются. Перед PR: `pnpm exec tsc -b`, `pnpm lint`, тесты сервера.
