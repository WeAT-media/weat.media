#!/usr/bin/env bash
# PDS хранит данные в SQLite: общие базы (account, sequencer, did_cache) и по файлу на
# пользователя (actors/<xx>/<did>/store.sqlite), новые появляются на ходу. Litestream
# так не умеет, поэтому: каждые BACKUP_INTERVAL_SEC — sqlite3 .backup каждой базы
# (согласованный снимок даже под записью) + blobs, затем restic в S3 контура.
#
#   pds-backup loop        — цикл на primary (по умолчанию)
#   pds-backup once        — один снимок
#   pds-backup restore     — на standby при переключении: последний снимок -> PDS_DIR
#   pds-backup snapshots   — список снимков
#
# Потеря данных при аварии — не больше BACKUP_INTERVAL_SEC.
set -euo pipefail

: "${PDS_DIR:=/pds}"
: "${BACKUP_INTERVAL_SEC:=300}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY (s3:https://... своего контура)}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD}"
STAGE=/cache/stage
KEEP="--keep-within 2d --keep-hourly 72 --keep-daily 30 --keep-weekly 12"

init_repo() {
  restic snapshots >/dev/null 2>&1 || restic init
}

snapshot() {
  rm -rf "$STAGE" && mkdir -p "$STAGE"
  local n=0
  while IFS= read -r -d '' db; do
    local rel="${db#"$PDS_DIR"/}"
    mkdir -p "$STAGE/$(dirname "$rel")"
    # .backup — онлайн-копия с учётом WAL; копировать файл напрямую под записью нельзя
    sqlite3 "$db" ".timeout 5000" ".backup '$STAGE/$rel'"
    n=$((n + 1))
  done < <(find "$PDS_DIR" -name '*.sqlite' -type f -print0)
  # blobs (картинки) неизменяемы — копируем как есть
  if [ -d "$PDS_DIR/blocks" ]; then cp -a "$PDS_DIR/blocks" "$STAGE/"; fi
  restic backup --host pds --tag pds "$STAGE" --quiet
  echo "$(date -Is) snapshot ok: $n баз"
}

case "${1:-loop}" in
  loop)
    init_repo
    while true; do
      snapshot || echo "$(date -Is) snapshot FAILED" >&2
      # чистка старых снимков раз в час
      if [ "$(date +%M)" -lt "$(( BACKUP_INTERVAL_SEC / 60 + 1 ))" ]; then restic forget --tag pds $KEEP --prune --quiet || true; fi
      sleep "$BACKUP_INTERVAL_SEC"
    done
    ;;
  once)
    init_repo
    snapshot
    ;;
  snapshots)
    restic snapshots --tag pds
    ;;
  restore)
    # PDS на этом узле должен быть остановлен: docker compose stop pds
    if [ -f "$PDS_DIR/account.sqlite" ] && [ "${FORCE:-}" != "1" ]; then
      echo "в $PDS_DIR уже есть данные — FORCE=1, чтобы перезаписать" >&2
      exit 1
    fi
    tmp=/cache/restore && rm -rf "$tmp"
    restic restore latest --tag pds --target "$tmp"
    cp -a "$tmp$STAGE/." "$PDS_DIR/"
    # WAL/SHM старого процесса не нужны: снимок самодостаточен
    find "$PDS_DIR" -name '*.sqlite-wal' -delete -o -name '*.sqlite-shm' -delete
    echo "восстановлено в $PDS_DIR — запустите PDS: docker compose start pds"
    ;;
  *)
    sed -n '2,13p' "$0"
    exit 1
    ;;
esac
