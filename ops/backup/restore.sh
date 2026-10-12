#!/usr/bin/env bash
# Restauración de un respaldo de ops/backup/backup.sh (Fase 4). Procedimiento completo en docs/deploy.md.
#
#   ops/backup/restore.sh <archivo.dump[.gpg]> <RESTORE_DATABASE_URL>
#
# Restaura en una base VACÍA (nunca encima de la de producción por accidente): si la base destino ya tiene tablas,
# se detiene. Para sobrescribir a propósito: FORCE_OVERWRITE=1 (borra los esquemas public, drizzle y pgboss).
# Si el archivo termina en .gpg, BACKUP_PASSPHRASE debe tener la misma frase con la que se cifró.
#
# Al terminar muestra las filas de las tablas clave y la última migración aplicada; si no se pueden leer, falla con
# código ≠ 0. La comparación exacta origen-vs-restaurado la hace el simulacro de CI (.github/workflows/ci.yml).
set -euo pipefail

src="${1:?Uso: restore.sh <archivo.dump[.gpg]> <RESTORE_DATABASE_URL>}"
target="${2:?Uso: restore.sh <archivo.dump[.gpg]> <RESTORE_DATABASE_URL>}"
[[ -f "$src" ]] || { echo "[restore] no existe $src" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
dump="$src"
if [[ "$src" == *.gpg ]]; then
  : "${BACKUP_PASSPHRASE:?El respaldo está cifrado: define BACKUP_PASSPHRASE}"
  dump="$work/backup.dump"
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt --output "$dump" "$src" 3<<<"$BACKUP_PASSPHRASE"
fi

tables="$(psql "$target" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [[ "$tables" != "0" ]]; then
  if [[ "${FORCE_OVERWRITE:-}" != "1" ]]; then
    echo "[restore] la base destino ya tiene $tables tablas. Restaura en una base vacía o usa FORCE_OVERWRITE=1." >&2
    exit 1
  fi
  echo "[restore] FORCE_OVERWRITE=1: se borran los esquemas public, drizzle y pgboss de la base destino"
  # El respaldo trae los tres (datos, registro de migraciones y cola de trabajos): se recrean desde el archivo.
  psql "$target" -v ON_ERROR_STOP=1 -qc 'drop schema if exists public cascade; drop schema if exists drizzle cascade; drop schema if exists pgboss cascade; create schema public;'
fi

echo "[restore] restaurando…"
# Las extensiones (pg_trgm, btree_gin) vienen en el respaldo; el rol destino debe poder crearlas.
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$target" "$dump"

echo "[restore] verificando…"
status=0
for table in businesses users clients items appointments sales; do
  restored="$(psql "$target" -Atc "select count(*) from public.$table")"
  echo "  $table: $restored filas"
  [[ "$restored" =~ ^[0-9]+$ ]] || status=1
done
last="$(psql "$target" -Atc 'select max(created_at) from drizzle.__drizzle_migrations' 2>/dev/null || true)"
echo "  última migración (created_at): ${last:-desconocida}"
[[ -n "$last" ]] || status=1
if ((status)); then echo "[restore] ERROR: la verificación falló" >&2; exit 1; fi
echo "[restore] listo: base restaurada y verificada"
