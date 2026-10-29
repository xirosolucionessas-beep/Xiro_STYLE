# Despliegue en producción — Xiro Style 2.0

Guía genérica: sirve para cualquier proveedor que ejecute contenedores Docker (Render, Railway, Fly.io, un VPS…).
Cuando se elija proveedor se añade su archivo concreto (p. ej. `render.yaml`); nada de lo de aquí cambia.

## 1. Arquitectura

```
Clientes (app iOS/Android, panel web, página /reservar)
        │  HTTPS
        ▼
Cloudflare (DNS, TLS, CDN para /media y estáticos, WAF, protección DDoS)
        │
        ▼
Balanceador del proveedor ──► N instancias de la API (imagen Docker de este repo, sin estado)
                                   │            │             │
                                   ▼            ▼             ▼
                      PostgreSQL gestionado   Redis gestionado   Cloudflare R2 (imágenes)
                      (respaldos + PITR)      (límites y caché)
```

- La API **no guarda estado en disco**: imágenes en R2, límites de abuso y caché pública en Redis. Se puede escalar
  horizontalmente añadiendo instancias.
- La misma imagen sirve la API (`/api`), el panel web y la página pública de reservas (`/reservar/<negocio>`).
- Tamaños de partida y capacidad **medidos**: [`docs/capacity.md`](capacity.md) (Fase 5). Resumen: ~160 req/s de tráfico mixto
  por proceso, sin errores; se escala añadiendo instancias.

## 2. Variables de entorno

La lista completa y comentada está en [`apps/api/.env.example`](../apps/api/.env.example). Antes de desplegar:

```bash
cd apps/api
npx tsx --env-file=.env.production scripts/check-env.ts   # mismas reglas que el arranque, sin mostrar secretos
```

La API **no arranca** si falta algo crítico en producción (`NODE_ENV=production`):

| Variable | Obligatoria | Notas |
|---|---|---|
| `DATABASE_URL` | Sí | Con TLS (`DATABASE_SSL=require` por defecto en producción). Si va por PgBouncer en modo transacción: `DB_SESSION_PARAMS=none` y `DATABASE_DIRECT_URL` (conexión directa para migraciones, LISTEN y la cola). |
| `JWT_SECRET` | Sí | ≥ 32 caracteres aleatorios (`openssl rand -base64 48`). Cambiarlo cierra todas las sesiones. |
| `REDIS_URL` | Sí | `rediss://` (TLS) si el proveedor lo ofrece. |
| `MEDIA_STORAGE=s3` + `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Sí | Cloudflare R2 (`S3_REGION=auto`). |
| `NOTIFIER_PROVIDER` | Sí (≠ `console`) | **Pendiente**: aún no hay proveedor de SMS/WhatsApp/correo para los códigos OTP; la API se niega a arrancar en producción con `console`. |
| `CORS_ORIGINS` | Según el caso | Orígenes exactos con `https` (nunca `*`). Vacío = solo la web servida por la misma API. |
| `TRUST_PROXY` | **Sí, detrás de un balanceador** | Número de proxies de confianza (p. ej. `1`). Sin esto todas las peticiones parecen venir de la IP del balanceador y los límites por IP bloquearían a todos a la vez. |
| `ADMIN_SECRET` | Solo si se confirman transferencias | ≥ 32 caracteres; opcional `ADMIN_ALLOWED_IPS`. |
| `TURNSTILE_SECRET` / `TURNSTILE_SITE_KEY` | Recomendado | Captcha de la página pública de reservas. |
| `SENTRY_DSN`, `RELEASE` | Recomendado | Errores en Sentry (ver §6). `RELEASE` = commit desplegado. |
| `METRICS_TOKEN` | Recomendado | Habilita `GET /api/metrics` (Prometheus). |
| `AUTO_MIGRATE` | — | `false` por defecto en producción: las migraciones son un paso aparte del despliegue (§4). |

Los secretos van **solo** en el gestor de secretos del proveedor (nunca en el repositorio, nunca en la imagen:
`.dockerignore` excluye todos los `.env*`).

## 3. La imagen

```bash
docker build -t xiro-api:$(git rev-parse --short HEAD) .
docker run --env-file .env.production -e RELEASE=$(git rev-parse --short HEAD) -p 3000:3000 --memory 512m \
  -e NODE_OPTIONS=--max-old-space-size=320 -e MAX_HEAP_USED_MB=256 -e EXPORT_WORKERS=1 xiro-api:<tag>
```

- Multi-etapa, base `node:24-bookworm-slim`, solo dependencias de producción, usuario sin privilegios (`node`, uid 1000).
  En producción conviene fijar la base por digest (`node:24-bookworm-slim@sha256:…`).
- **Memoria**: `NODE_OPTIONS=--max-old-space-size` ≈ 75 % del límite del contenedor, o ≈ 62 % si hay hilos de descarga (ver la tabla siguiente); `MAX_HEAP_USED_MB` ≈ 80 % de
  ese valor (pasado el tope la API responde 503 + `Retry-After` en vez de morir por falta de memoria).
- **Descargas PDF/Excel** (`EXPORT_WORKERS`, por defecto 2): cada hilo tiene su PROPIO heap, de como mucho
  `EXPORT_WORKER_MEMORY_MB` (256). El presupuesto del contenedor es: heap de la API + `EXPORT_WORKERS` × uso real del
  hilo + ~100 MB nativos. El uso medido por hilo es ~130 MB en total, y el Excel por flujo usa ~35 MB de heap aun con
  50.000 filas (`docs/finance-capacity.md`). Guía:

  | Límite del contenedor | `--max-old-space-size` | `EXPORT_WORKERS` |
  |---|---|---|
  | 512 MB | 320 | **1** |
  | 1 GB | 640 | 2 |
  | 2 GB o más | 1.280 | 2–4 |

  Vigila `xiro_export_waiting` en `/api/metrics`: si se acerca a `EXPORT_QUEUE_MAX`, las descargas siguientes reciben
  503 y conviene más memoria o más instancias.
- **Salud** (configúralas en el balanceador/orquestador):
  - Liveness: `GET /api/health` → 200 si el proceso atiende (no depende de la base de datos).
  - Readiness: `GET /api/health/ready` → 200 si PostgreSQL (y Redis) responden; 503 = sacar la instancia del balanceo.
- **Cierre ordenado**: con `SIGTERM` deja de aceptar conexiones, termina lo que está en curso y cierra la base, la cola
  y Redis (tope `SHUTDOWN_TIMEOUT_MS`, 25 s). Da al orquestador ≥ 30 s de gracia.
- **Keep-alive**: `KEEP_ALIVE_TIMEOUT_MS` (72 s) mayor que el del balanceador (60 s en la mayoría) para evitar 502.
- Cada respuesta lleva `X-Request-Id` (el del balanceador si lo envía): búscalo en los logs para seguir una petición.

## 4. Despliegue paso a paso

1. CI en verde (typecheck, lint, pruebas, auditoría, imagen Docker y simulacro de respaldo: `.github/workflows/ci.yml`).
2. **Respaldo** antes de migrar (§5) si el despliegue trae migraciones nuevas (`apps/api/drizzle/`).
3. **Migraciones** como paso único (un solo proceso, con candado: es seguro aunque se lance dos veces):
   ```bash
   docker run --rm --env-file .env.production xiro-api:<tag> node dist/migrate-cli.js
   ```
   Cada migración tiene su reversión manual en `apps/api/drizzle/rollback/` cuando aplica.
   - **0036** (índices del balance) usa `CREATE INDEX`, que bloquea las escrituras de `service_records` y `sales` mientras
     se construye (segundos en tablas grandes). Aplícala en un horario de poco uso, o crea antes los índices con
     `CREATE INDEX CONCURRENTLY` (mismos nombres; el `IF NOT EXISTS` de la migración los deja tal cual) — conéctate
     directo a PostgreSQL (nunca a través de un pooler en modo transacción: `CONCURRENTLY` necesita su propia sesión,
     sin transacción envolvente) y ejecuta cada `CREATE INDEX` como una sentencia suelta, no dentro de un `BEGIN`:
     ```sql
     CREATE INDEX CONCURRENTLY IF NOT EXISTS "service_records_balance_idx" ON "service_records"
       USING btree ("business_id", "created_at") INCLUDE ("amount", "kind") WHERE "voided" = false;

     CREATE INDEX CONCURRENTLY IF NOT EXISTS "sales_balance_idx" ON "sales"
       USING btree ("business_id", "created_at") INCLUDE ("discount", "tip") WHERE "status" = 'completed';
     ```
     Verifica que los dos quedaron válidos antes de desplegar la migración (un `CONCURRENTLY` interrumpido deja un
     índice `INVALID`, inválido pero presente — la migración 0036 fallaría con "ya existe" al toparse con él):
     ```sql
     SELECT indexrelid::regclass, indisvalid FROM pg_index
       WHERE indexrelid IN ('service_records_balance_idx'::regclass, 'sales_balance_idx'::regclass);
     ```
     Si alguno sale `indisvalid = false`, bórralo (`DROP INDEX CONCURRENTLY "<nombre>"`) y repite su `CREATE INDEX
     CONCURRENTLY` antes de aplicar la migración 0036 (que entonces solo confirma que ya existen, sin bloquear nada).
   - Las migraciones solo pueden usar caracteres de Windows-1252 (`test/migrationFiles.test.ts`): un "→" en un comentario
     hizo fallar una.
4. Desplegar la nueva imagen (rolling: el balanceador solo manda tráfico a instancias con readiness en 200).
5. Verificar: `/api/health/ready`, Sentry sin errores nuevos, `xiro_http_requests_total{status="5xx"}` sin subir.
6. Reversión: volver a la imagen anterior (las migraciones son aditivas; si una no lo es, su `rollback/` lo indica).

## 5. Respaldos y restauración

**Tres capas**:

1. **Proveedor gestionado**: respaldos automáticos diarios + restauración a un punto en el tiempo (PITR). Actívalos y
   fija la retención (mínimo 7 días; recomendado 30).
2. **Copia fuera del proveedor**: `.github/workflows/backup.yml` corre `ops/backup/backup.sh` cada día (03:00 Colombia):
   `pg_dump` verificado, cifrado con GPG (AES-256) y subido a R2. Secretos necesarios: ver la cabecera del workflow.
   - Usuario de solo lectura para respaldar:
     ```sql
     CREATE ROLE xiro_backup LOGIN PASSWORD '<aleatoria>';
     GRANT pg_read_all_data TO xiro_backup;   -- PostgreSQL 14+
     ```
   - Retención en R2: regla de ciclo de vida del bucket (p. ej. borrar objetos de más de 35 días).
   - Guarda `BACKUP_PASSPHRASE` también fuera de GitHub (gestor de contraseñas): sin ella el respaldo no sirve.
3. **Simulacro automático**: en cada CI, `backup-drill` respalda una base con datos reales, la restaura en otra y
   compara tabla por tabla. Un respaldo que no se ha restaurado nunca no es un respaldo.

**Restaurar** (incidente o prueba manual):

```bash
# 1. Descargar el respaldo (R2) y crear una base VACÍA
aws s3 cp --endpoint-url "$BACKUP_S3_ENDPOINT" s3://xiro-backups/postgres/xiro-<fecha>.dump.gpg .
psql "$ADMIN_URL" -c 'CREATE DATABASE xiro_restaurada'
# 2. Restaurar y verificar (se niega a escribir sobre una base con tablas)
BACKUP_PASSPHRASE=… ops/backup/restore.sh xiro-<fecha>.dump.gpg "postgres://…/xiro_restaurada"
# 3. Revisar los datos y apuntar DATABASE_URL a la base restaurada (o renombrarla) en una ventana de mantenimiento.
```

Recomendado: ensayar una restauración manual cada trimestre y anotar cuánto tardó (tiempo real de recuperación).

| Fecha | Qué | Resultado |
|---|---|---|
| 2026-10-14 | Respaldo de la base de **desarrollo** (`pg_dump` formato custom, 847 KB) restaurado en una base nueva y aparte | **8 s**. 55 tablas y 9.161 filas, sin diferencias tabla por tabla. RLS (28 tablas), 28 políticas y 103 permisos de `xiro_app` idénticos. Base del simulacro borrada. Falta medirlo con el volumen real de producción. |

## 6. Monitoreo

- **Logs** estructurados (JSON) con `requestId`; nunca contraseñas, tokens, cookies ni enlaces de citas (se redactan).
- **Errores — Sentry** (gratis hasta 5.000 errores/mes):
  - API: implementado. Define `SENTRY_DSN` (+ `RELEASE`). Solo errores 500 y fallos de proceso; sin cuerpos, cookies,
    cabeceras de sesión, IP ni consulta de la URL; del usuario solo el id.
  - App móvil y panel web — plan (requiere una compilación de desarrollo/EAS, no funciona en Expo Go):
    1. `npx expo install @sentry/react-native` y añadir el plugin `@sentry/react-native/expo` en `app.json`.
    2. `Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN, sendDefaultPii: false, tracesSampleRate: 0.1 })` en
       `src/app/_layout.tsx`, envolviendo el layout con `Sentry.wrap`. El DSN es público por diseño.
    3. Subida de source maps en la compilación de EAS (`SENTRY_AUTH_TOKEN` como secreto de EAS).
    4. `beforeSend` que quite el cuerpo de las peticiones y los parámetros de URL (mismas reglas que la API).
- **Métricas**: `GET /api/metrics` con `Authorization: Bearer $METRICS_TOKEN`. Cualquier recolector Prometheus
  (Grafana Cloud tiene plan gratuito). Alertas sugeridas:
  - 5xx > 1 % durante 5 min · p95 de `xiro_http_request_duration_seconds` > 1 s durante 10 min
  - `xiro_db_pool_waiting` > 0 sostenido (pool chico o consultas lentas) · readiness en 503
  - `xiro_event_loop_delay_p99_seconds` > 0,5 · memoria residente > 85 % del límite
- **Disponibilidad externa**: un monitor (UptimeRobot/Better Stack, gratis) a `/api/health/ready` cada minuto.

## 7. Seguridad de la operación

- HTTPS en todo (HSTS activo en producción). Cloudflare en modo **Full (strict)**.
- Base de datos y Redis sin acceso público, o con lista de IPs permitidas + TLS.
- Rotación: `JWT_SECRET` (cierra sesiones), credenciales de la base, R2 y webhooks, al menos una vez al año y siempre
  que alguien con acceso deje el equipo.
- Ataques de denegación de servicio a gran escala dependen de la infraestructura (Cloudflare/WAF), no de la API.
