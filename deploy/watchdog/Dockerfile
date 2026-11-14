# Сторож узлов: проверяет здоровье соседей и шлёт тревогу (почта + Telegram). Сам ничего не переключает.
FROM alpine:3.21
RUN apk add --no-cache bash curl coreutils
COPY watchdog.sh /usr/local/bin/watchdog
RUN chmod +x /usr/local/bin/watchdog
ENTRYPOINT ["watchdog"]
