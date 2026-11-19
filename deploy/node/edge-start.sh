#!/bin/sh
set -eu

node /srv-ssr/server.mjs &
ssr_pid=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!
trap 'kill "$ssr_pid" "$caddy_pid" 2>/dev/null || true' TERM INT
while kill -0 "$ssr_pid" 2>/dev/null && kill -0 "$caddy_pid" 2>/dev/null; do
  sleep 5
done
exit 1
