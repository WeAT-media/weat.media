#!/usr/bin/env bash
# Сторож: раз в WATCH_INTERVAL_SEC проверяет /api/health узлов напрямую по IP (мимо GeoDNS).
# После WATCH_FAILS неудач подряд — тревога, после восстановления — отбой. Сам не переключает:
# переключение — workflow «Failover RU» (решение принимает человек, split-brain исключён).
#
#   WATCH_TARGETS="ru-1=192.144.59.201 nl-1=212.34.151.235"   имя=IP через пробел
#   WATCH_HOST=weat.media                                      имя для TLS/Host
#   WATCH_FROM=nl-1                                            откуда смотрим (в тексте тревоги)
#   ALERT_EMAIL, SMTP_URL (smtps://host:465 | smtp://host:587), SMTP_USER, SMTP_PASSWORD
#   ALERT_TELEGRAM_TOKEN, ALERT_TELEGRAM_CHAT
set -uo pipefail

: "${WATCH_TARGETS:?WATCH_TARGETS}"
: "${WATCH_HOST:=weat.media}"
: "${WATCH_FROM:=$(hostname)}"
: "${WATCH_INTERVAL_SEC:=30}"
: "${WATCH_FAILS:=6}"
: "${FAILOVER_URL:=https://github.com/WeAT-media/weat.media/actions/workflows/failover.yml}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

telegram() {
  [ -n "${ALERT_TELEGRAM_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT:-}" ] || return 0
  curl -fsS -m 15 "https://api.telegram.org/bot${ALERT_TELEGRAM_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT}" --data-urlencode "text=$1" >/dev/null \
    || log "telegram: не отправлено"
}

email() {
  [ -n "${ALERT_EMAIL:-}" ] && [ -n "${SMTP_URL:-}" ] || return 0
  local from=${SMTP_USER:-noreply@weat.media}
  printf 'From: weAT.media watchdog <%s>\r\nTo: %s\r\nSubject: =?UTF-8?B?%s?=\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n' \
    "$from" "$ALERT_EMAIL" "$(printf '%s' "$1" | base64 -w0)" "$2" \
    | curl -fsS -m 30 --ssl-reqd "$SMTP_URL" --mail-from "$from" --mail-rcpt "$ALERT_EMAIL" \
        --user "$from:${SMTP_PASSWORD:-}" -T - >/dev/null \
    || log "email: не отправлено"
}

alert() { log "ALERT $1"; telegram "$1"$'\n\n'"$2"; email "$1" "$2"; }

healthy() {
  curl -fsS -m 10 -o /dev/null --resolve "$WATCH_HOST:443:$1" "https://$WATCH_HOST/api/health"
}

declare -A fails down
for t in $WATCH_TARGETS; do fails[${t%%=*}]=0; down[${t%%=*}]=0; done
log "watch from $WATCH_FROM: $WATCH_TARGETS every ${WATCH_INTERVAL_SEC}s, alert after $WATCH_FAILS"

while true; do
  for t in $WATCH_TARGETS; do
    name=${t%%=*} ip=${t#*=}
    if healthy "$ip"; then
      if [ "${down[$name]}" = 1 ]; then
        alert "✅ $name снова отвечает (проверка с $WATCH_FROM)" "Узел $name ($ip) восстановился. Если уже переключались на резерв — не запускайте его как основной: workflow «Failover RU», режим fence-ru1."
      fi
      fails[$name]=0 down[$name]=0
    else
      fails[$name]=$(( fails[$name] + 1 ))
      if [ "${fails[$name]}" -ge "$WATCH_FAILS" ] && [ "${down[$name]}" = 0 ]; then
        down[$name]=1
        mins=$(( WATCH_FAILS * WATCH_INTERVAL_SEC / 60 ))
        alert "🔴 $name не отвечает ${mins} мин (проверка с $WATCH_FROM)" "https://$WATCH_HOST/api/health на $ip не отвечает $WATCH_FAILS раз подряд.

Если вторая точка тоже прислала тревогу — узел лежит.
Сначала проверка резерва: $FAILOVER_URL → Run workflow → mode=check
Переключение: тот же workflow, mode=failover, confirm=RU-2"
      fi
    fi
  done
  sleep "$WATCH_INTERVAL_SEC"
done
