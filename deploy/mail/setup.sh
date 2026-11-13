#!/usr/bin/env bash
# Ящики и псевдонимы — один раз на узле. Пароли создаются здесь и пишутся в ./passwords (600),
# в git и в CI не попадают. Повторный запуск существующие ящики не трогает.
set -euo pipefail
cd "$(dirname "$0")"
D=${MAIL_DOMAIN:-weat.media}
umask 077
touch passwords
dms() { docker compose exec -T mailserver setup "$@"; }
for box in noreply support legal; do
  addr="$box@$D"
  if dms email list 2>/dev/null | grep -q "$addr"; then continue; fi
  pw=$(openssl rand -base64 24 | tr -d '/+=')
  dms email add "$addr" "$pw"
  printf '%s %s\n' "$addr" "$pw" >> passwords
done
for alias in postmaster abuse; do
  dms alias list 2>/dev/null | grep -q "^\* $alias@$D" || dms alias add "$alias@$D" "support@$D"
done
[ -s config/rspamd/dkim/rsa-2048-mail-$D.public.txt ] 2>/dev/null || dms config dkim keysize 2048 domain "$D" >/dev/null
echo "ящики:"; dms email list
echo "DKIM (TXT mail._domainkey.$D):"; cat config/rspamd/dkim/rsa-2048-mail-$D.public.dns.txt 2>/dev/null || ls config/rspamd/dkim
