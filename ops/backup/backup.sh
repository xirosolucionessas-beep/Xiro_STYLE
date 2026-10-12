#!/usr/bin/env bash
# Respaldo lógico de PostgreSQL (Fase 4). Sirve con cualquier proveedor: complementa (no reemplaza) los respaldos
# automáticos del proveedor gestionado, y deja una copia FUERA de él (p. ej. en Cloudflare R2).
#
#   BACKUP_DATABASE_URL=postgres://…  ops/backup/backup.sh
#
# Variables:
#   BACKUP_DATABASE_URL   (obligatoria) conexión DIRECTA a la base (no a través de PgBouncer en modo transacción).
#   BACKUP_DIR            carpeta local de salida (por defecto ./backups).
#   BACKUP_KEEP           cuántos respaldos locales conservar (por defecto 7).
#   BACKUP_PASSPHRASE     si se define, el archivo se cifra con GPG (AES-256) antes de guardarlo/subirlo.
#   BACKUP_S3_URI         si se define (s3://bucket/carpeta), se sube ahí con la CLI de AWS.
#   BACKUP_S3_ENDPOINT    endpoint S3-compatible (R2: https://<cuenta>.r2.cloudflarestorage.com).
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION (R2: "auto") para la subida.
#
# Requisitos: pg_dump y pg_restore de la MISMA versión mayor que el servidor o mayor; gpg y aws solo si se usan.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?Define BACKUP_DATABASE_URL (conexión directa a la base)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/xiro-$stamp.dump"

echo "[backup] $(date -u +%FT%TZ) volcando la base…"
# Formato custom (-Fc): comprimido, y permite restaurar tablas sueltas. Sin dueños ni permisos: se restaura en
# cualquier servidor/rol. Lectura consistente (una sola transacción) sin bloquear a la API.
pg_dump --format=custom --no-owner --no-privileges --file="$file" "$BACKUP_DATABASE_URL"

# Verificación: el archivo se puede leer y trae las tablas clave (un respaldo que no se puede restaurar no es respaldo).
toc="$(pg_restore --list "$file")"
for table in businesses users clients items appointments sales; do
  grep -q "TABLE DATA public $table " <<<"$toc" || { echo "[backup] ERROR: falta la tabla $table en el respaldo" >&2; exit 1; }
done
size="$(du -h "$file" | cut -f1)"
echo "[backup] verificado ($size): $file"

if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 --output "$file.gpg" "$file" 3<<<"$BACKUP_PASSPHRASE"
  rm -f "$file"
  file="$file.gpg"
  echo "[backup] cifrado: $file"
fi

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  endpoint=()
  [[ -n "${BACKUP_S3_ENDPOINT:-}" ]] && endpoint=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  aws s3 cp "${endpoint[@]}" --only-show-errors "$file" "${BACKUP_S3_URI%/}/$(basename "$file")"
  echo "[backup] subido a ${BACKUP_S3_URI%/}/$(basename "$file")"
  # La retención remota la aplica una regla de ciclo de vida del bucket (ver docs/deploy.md), no este script.
fi

# Retención local: se conservan los BACKUP_KEEP más recientes.
mapfile -t old < <(ls -1t "$BACKUP_DIR"/xiro-*.dump* 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))")
if ((${#old[@]})); then rm -f -- "${old[@]}"; echo "[backup] retención: borrados ${#old[@]} respaldos antiguos"; fi
echo "[backup] listo"
