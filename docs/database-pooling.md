# Conexiones a PostgreSQL en producción

La API usa un pool de `pg` por instancia, más algunas conexiones que necesitan una **sesión fija**. Esta guía explica
cómo dimensionarlo y cómo ponerle delante PgBouncer o el pooler de tu proveedor sin romper nada.

## Qué conexiones abre cada instancia de la API

| Uso | Conexión | Cuántas | ¿Puede pasar por un pooler en modo transacción? |
|---|---|---|---|
| Peticiones HTTP (todas las rutas) | `DATABASE_URL` | hasta `DB_POOL_MAX` | **Sí** (con `DB_SESSION_PARAMS=none`) |
| Agenda en tiempo real (`LISTEN`, `realtime.ts`) | `DATABASE_DIRECT_URL` → si no, `DATABASE_URL` | 1 | **No** — `LISTEN` exige sesión fija |
| Cola de recordatorios (`pg-boss`) | `DATABASE_DIRECT_URL` → si no, `DATABASE_URL` | pool propio (pequeño) | **No** recomendado |
| Migraciones (candado `pg_advisory_lock`) | siempre la directa | 1 | **No** — el candado es de sesión |

## Dimensionar el pool

Regla práctica: `instancias de la API × (DB_POOL_MAX + 3)` < `max_connections` del servidor, dejando margen para
administración y backups.

| Plan de base de datos (aprox.) | `max_connections` típico | Recomendación sin pooler |
|---|---|---|
| 1 GB RAM | 25–50 | 2 instancias × `DB_POOL_MAX=8` |
| 4 GB RAM | 100–200 | 3–4 instancias × `DB_POOL_MAX=15` |

Más conexiones **no** es más rápido: por encima de ~2–4 por núcleo de la base de datos aumenta la contención. Si
necesitas más instancias que eso, pon un pooler delante (siguiente sección). Estas cifras son un punto de partida; la
Fase 5 (pruebas de carga) dará los valores medidos.

## Tiempos de espera (ya configurados)

| Variable | Por defecto | Qué hace |
|---|---|---|
| `DB_CONNECTION_TIMEOUT_MS` | 5000 | Si el pool está lleno, la petición falla rápido (503) en vez de esperar indefinidamente |
| `DB_IDLE_TIMEOUT_MS` | 30000 | Cierra conexiones ociosas tras un pico |
| `DB_STATEMENT_TIMEOUT_MS` | 15000 | `statement_timeout` en el servidor + `query_timeout` (+2 s) en el cliente |
| (derivado) | 2 × statement | `idle_in_transaction_session_timeout`: una transacción abandonada no retiene filas bloqueadas |
| `DB_MAX_LIFETIME_SECONDS` | 1800 | Recicla conexiones viejas (failovers, balanceadores) |
| `SHUTDOWN_TIMEOUT_MS` | 25000 | Tope del cierre ordenado al recibir `SIGTERM` |

## Con PgBouncer o el pooler del proveedor

PgBouncer en **modo transacción** (y la mayoría de poolers gestionados: Supabase Supavisor, Neon, DigitalOcean,
Render…) **rechaza** los parámetros de arranque `statement_timeout` e `idle_in_transaction_session_timeout`, y no
admite `LISTEN` ni candados de sesión. Configuración:

1. `DATABASE_URL` → la URL **del pooler** (puerto del pooler, p. ej. 6543 en Supabase).
2. `DATABASE_DIRECT_URL` → la URL **directa** a PostgreSQL (puerto 5432). En producción la API no arranca si falta.
3. `DB_SESSION_PARAMS=none` → la API deja de enviar esos parámetros al conectar.
4. Aplica los tiempos de espera **en el rol** (una sola vez, con un usuario administrador):

   ```sql
   ALTER ROLE xiro_app SET statement_timeout = '15s';
   ALTER ROLE xiro_app SET idle_in_transaction_session_timeout = '30s';
   ```

   El `query_timeout` del cliente sigue activo siempre, así que una consulta colgada nunca retiene la petición más de
   `DB_STATEMENT_TIMEOUT_MS + 2 s`.
5. Pool de PgBouncer: `pool_mode = transaction`, `default_pool_size` ≈ 2–4 × núcleos de la base de datos. Con el pooler
   delante, `DB_POOL_MAX` por instancia puede subir (p. ej. 20) sin agotar `max_connections`.

### Candados de la caja (concurrencia del cierre)

El cierre de caja y las ventas y gastos se coordinan con `pg_advisory_xact_lock`, un candado de **transacción**
(`docs/cash-concurrency.md`): se libera al confirmar o revertir y no depende de la sesión. Por eso **funciona igual** detrás
de PgBouncer en modo transacción, a diferencia del candado de sesión de las migraciones.

## Comprobación rápida

```sql
-- Conexiones abiertas por la API (application_name = 'xiro-api')
SELECT state, count(*) FROM pg_stat_activity WHERE application_name = 'xiro-api' GROUP BY state;
-- Tiempos de espera efectivos de la sesión
SHOW statement_timeout; SHOW idle_in_transaction_session_timeout;
```
