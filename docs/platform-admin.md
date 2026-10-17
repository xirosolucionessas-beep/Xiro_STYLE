# Panel del fundador y administración de la plataforma

Estado: implementado y probado con datos de prueba (2026-10-17). **No desplegado.** Ninguna suspensión, extensión ni baja se ejecutó sobre datos reales.

- Web: `/platform` (no hay enlace en la app; se entra escribiendo la dirección). Android/iOS: `xirostyle://platform`.
- API: `/api/platform/*`. **Solo existe con `PLATFORM_ADMIN_KEY` configurada**; sin ella responde 404.

## 1. Inspección inicial (lo que había)

| Tema | Estado encontrado |
|---|---|
| Stack | Monorepo TypeScript: API Fastify 5 + PostgreSQL (Drizzle, migraciones versionadas en `apps/api/drizzle` con reversión manual desde la 0024); app Expo SDK 57 (Android, iOS y web desde el mismo código, pantallas web propias `*.web.tsx`); `packages/shared` con esquemas Zod y tipos. |
| Negocios y personas | `businesses` (un negocio por registro), `users` con `role` `owner`/`employee` y `active`; `employee_profiles` para la agenda. |
| Suscripciones | `subscriptions` (una fila por negocio, RevenueCat/Stripe/PayPal/transferencia), `subscription_events`, `subscription_invoices` (pagos confirmados). El acceso (`hasAccess`) se deriva en el servidor pero **solo lo aplica la app** (aviso bloqueante); el backend no bloquea la API por falta de pago. |
| Autenticación | JWT HS256 de 15 min + refresh token rotativo; en cada petición se relee usuario, rol y permisos de la base. Sin MFA. |
| Aislamiento | Filtro `business_id` en el código + RLS con el rol `xiro_app` en las tablas de citas, mensajes, etc. |
| Administración previa | Solo `POST /api/admin/subscription/confirm-bank-transfer`, protegida por un secreto compartido (`ADMIN_SECRET`). No había roles de plataforma, panel ni auditoría de administradores. |
| Métricas | `/api/metrics` (Prometheus, en memoria por proceso), `/api/health/ready`, Sentry opcional. No hay series de tiempo guardadas. |

**Datos que no se pueden calcular con fuentes confiables** (el panel los marca "No disponible" y explica por qué): usuarios concurrentes/activos ahora, historial de tráfico/errores/latencias (vive en Prometheus si se configura), historial del estado de cada suscripción, historial de empleados (no se guarda cuándo se desactivan), incidencias por negocio (Sentry no guarda el negocio en la base) y salud real de Stripe/PayPal/RevenueCat/Google (no se consultan para no gastar cuota; solo se informa si están configurados).

## 2. Qué se implementó

### Identidad y sesiones de administrador (separadas de los negocios)

- Tablas nuevas `platform_admins`, `platform_admin_sessions`. Un administrador **no** es un `users`: no tiene negocio, y un usuario de negocio no puede convertirse en administrador por ninguna ruta.
- **No hay registro público ni ruta HTTP que cree administradores o cambie permisos.** Solo el script de consola: `npm run platform:admin -w @xiro/api -- create|permissions|reset-password|reset-mfa|disable|enable|list`.
- Inicio de sesión con **contraseña (argon2id) + código TOTP (RFC 6238) en el mismo paso**. Mismo error (`invalid_credentials`) falle lo que falle; se evalúa siempre una contraseña (hash ficticio si la cuenta no existe).
- El secreto TOTP se guarda **cifrado** (AES-256-GCM, clave derivada de `PLATFORM_ADMIN_KEY`). Un código ya usado no vale otra vez (`totp_last_step`, consumo atómico).
- Token de sesión opaco con prefijo `xpa_` (solo su HMAC en la base), vida máxima 8 h, cierre por 30 min de inactividad, revocable (cerrar sesión, desactivar al admin, cambiar su contraseña o su MFA). Cada petición relee sesión, admin y permisos.
- **Reautenticación**: las acciones sensibles exigen un código TOTP verificado hace menos de `PLATFORM_STEP_UP_MINUTES` (5). Si no, `403 step_up_required` y la app pide un código nuevo (`POST /auth/step-up`).
- La app guarda el token **solo en memoria** (nada en localStorage, cookies ni Keychain): recargar obliga a entrar de nuevo.
- Fuerza bruta: tope por cuenta (reservado antes de verificar, aunque cambie la IP), por IP y por ruta; 120 peticiones/min por sesión. Lista blanca opcional de IPs (`PLATFORM_ADMIN_ALLOWED_IPS`, fuera de ella 404).
- CSRF: no aplica (no hay cookies; `Authorization: Bearer`). XSS: la app no inyecta HTML; React escapa todo. Inyección: consultas con parámetros enlazados; las partes dinámicas de SQL (agrupación, tabla de la serie) salen de listas cerradas validadas con Zod.

### Permisos (por defecto-denegar, verificados en el backend en cada endpoint)

| Permiso | Permite |
|---|---|
| `metrics_view` | Resumen e historial agregados (sin datos personales) |
| `businesses_view` | Buscar negocios y ver su ficha (dueño con correo/teléfono **enmascarados**) |
| `business_access_manage` | Suspender y reactivar |
| `business_extend` | Conceder y revocar acceso de cortesía |
| `business_deactivate` | Baja lógica y su recuperación |
| `audit_view` | Leer la bitácora de la plataforma |

El fundador (`is_founder`) tiene todos. Sin el permiso: `403` y queda registrado como `denied`.

### Panel principal (`GET /metrics/overview`, `GET /metrics/series`)

Cada indicador trae `state` (`ok` = dato real, un 0 con `ok` es cero real; `unavailable`; `unknown`; `error`), `source`, `formula`, `asOf` y advertencias.

| Indicador | Fuente y regla |
|---|---|
| Negocios totales / por estado de acceso / nuevos en el período | `businesses` (`access_status`, `created_at` en la zona horaria pedida) |
| Suscripciones por estado | `subscriptions` con el estado **efectivo** (misma regla que `deriveEffectiveStatus`); "sin plan" = negocios sin fila |
| Cobros programados 7 días, no renovarán | `subscriptions.next_billing_at`, `cancel_at_period_end` (programado, no cobrado) |
| Con acceso de cortesía | `business_access_grants` vigentes |
| Pagos del período | `subscription_invoices` (pagos confirmados), por moneda |
| Salud | Base (`select 1`), Redis (`PING`), almacenamiento (escritura en carpeta local o `HEAD` al bucket). Proveedores externos: solo "configurado / no configurado" |
| Tráfico y pool | Métricas en memoria **de la instancia que responde, desde su arranque** (percentiles aproximados por buckets) |
| Historial | Series por día/semana/mes: negocios nuevos, pruebas iniciadas, pagos confirmados, concesiones. Tope de barras por agrupación; períodos sin filas son ceros reales (cada fuente registra la fecha de cada evento) |

La app refresca el resumen como mucho cada 60 s y no reintenta en bucle; la búsqueda solo corre al pulsar "Buscar".

### Ficha de negocio (`GET /businesses/search`, `GET /businesses/:id`)

Búsqueda por correo exacto (dueño **o empleado**), nombre (contiene, comodines escapados), id o slug (también slugs anteriores); máximo 20 resultados. La ficha muestra identidad, estado, fechas, última actividad conocida (último inicio o renovación de sesión, puede subestimar), suscripción calculada **sin modificarla**, concesiones, acceso efectivo, conteo de dueños/empleados activos/inactivos **acotado por `business_id`**, historial administrativo. Sin listado individual de empleados (basta el agregado). Cada búsqueda y cada ficha abierta quedan en la bitácora (la búsqueda por correo **no** guarda el correo buscado).

### Suspensión y reactivación (`POST /businesses/:id/suspend|reactivate`)

Permiso + MFA reciente + motivo (≥ 10 caracteres) + escribir el slug exacto. En una transacción: bloqueo de la fila, transición válida (`409` si no), cambio de `businesses.access_status`, borrado de los refresh tokens de todas las personas del negocio y registro de auditoría con valores anterior/nuevo, motivo y sesiones cerradas.

Efecto (aplicado en el backend): `authenticate` lee el estado del negocio en cada petición (los access tokens vigentes dejan de servir al instante, `403 business_suspended`), login `403 business_suspended`, refresh `401`, y **sus páginas públicas (catálogo, reservas, cuentas de clientes) responden 404** porque el equipo no podría atender reservas nuevas. La app cierra la sesión al recibir `business_suspended`. **No** se cancela ningún pago ni se toca la suscripción o el proveedor.

Decisión tomada (cámbiala si no estás de acuerdo): ocultar las páginas públicas del negocio suspendido (no se aceptan reservas, pedidos ni reprogramaciones). Con su enlace personal, el cliente final **sí** puede seguir viendo y cancelando su cita y pidiendo el borrado de sus datos (son derechos suyos, no del negocio); reseñar no.

### Extensión de acceso (`POST /businesses/:id/grants`, `.../grants/:grantId/revoke`)

Tabla `business_access_grants`. Es una **cortesía administrativa**: no genera comprobante, no se cuenta como ingreso, no cambia `subscriptions` ni nada en Stripe/PayPal/tiendas. `GET /api/subscription` devuelve `hasAccess: true` y `accessGrantEndsAt` mientras cubra el presente; la app no muestra avisos de bloqueo/gracia en ese caso.

Reglas definidas:

- **Días** = bloques exactos de 24 h (UTC). **Meses** = meses calendario en UTC; si el día no existe, último día del mes (31 ene + 1 = 28/29 feb). Topes: 1–366 días, 1–24 meses.
- **Inicio** = lo más tardío entre ahora, el fin de la última concesión vigente y el fin del acceso por prueba o período pagado vigente. Una concesión siempre suma tiempo; una cuenta vencida cuenta desde hoy (no se devuelve tiempo vencido). Si el negocio tiene un período pagado vigente, la cortesía empieza al terminar ese período y **no pospone cobros del proveedor** (la app lo advierte).
- **Simultáneas**: bloqueo de la fila del negocio; se encadenan sin solaparse (probado con 5 a la vez).
- **Idempotencia**: la app genera una clave por formulario; repetirla devuelve la misma concesión (`200`, `replayed: true`); reutilizarla con otros datos da `409`.
- Una concesión no salta una suspensión. No se conceden a negocios dados de baja.
- Se registran motivo, cantidad, inicio/fin UTC, administrador, referencia de soporte opcional y el estado anterior.

### Eliminación de cuentas → baja lógica (`POST /businesses/:id/deactivate|restore`)

**No hay política aprobada de conservación y borrado definitivo, así que el panel solo permite una desactivación reversible.** Requiere su propio permiso (`business_deactivate`), MFA reciente, motivo, slug exacto y confirmación adicional en la app. Efecto: igual que suspender, pero solo se revierte con `restore` (y el mismo permiso). **No se borra nada**: empleados, clientes, citas, ventas, pagos, comprobantes, reportes, imágenes, auditoría y concesiones quedan intactos. La bitácora anota `physicalDeletion: no_programada`. Las concesiones tienen FK `ON DELETE RESTRICT` y la bitácora no tiene FK a `businesses`: un borrado físico futuro no podrá llevárselas en cascada sin una decisión explícita.

Para habilitar un borrado definitivo hace falta decidir (pendiente): plazo de retención tras la baja; qué se anonimiza vs. se borra (clientes y citas son datos personales de terceros); qué se conserva por obligación contable (comprobantes `subscription_invoices`, ventas); qué pasa con las imágenes en S3/R2; quién lo aprueba y cómo se notifica al dueño.

### Auditoría (`platform_audit_log`)

Registra inicios de sesión (éxito y fallo), reautenticaciones, cierres de sesión, accesos denegados, búsquedas, fichas consultadas, lecturas de la bitácora y toda acción, con administrador, acción, negocio, resultado, id de petición (`X-Request-Id`), IP y detalles (valores anterior/nuevo, motivo). **No** registra contraseñas, tokens, códigos ni cuerpos de petición (además, un filtro descarta claves con `pass|token|secret|totp|code|authorization|cookie`). Las acciones escriben su registro en la **misma transacción**: si no se puede auditar, la acción no ocurre.

**Inmutable desde la aplicación**: un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE`. Límite: el dueño de la tabla o un superusuario de PostgreSQL puede quitar el trigger; para eso valen respaldos y, si se requiere, enviar la bitácora a un almacén externo de solo escritura. Solo la leen administradores con `audit_view` (paginada de 50 en 50).

## 3. Archivos

- Migración: `apps/api/drizzle/0037_platform_admin.sql` (+ `meta/0037_snapshot.json`, `_journal.json`), reversión `apps/api/drizzle/rollback/0037_platform_admin.down.sql`.
- API: `src/platform/{crypto,session,audit,admins,businesses,grants,metrics}.ts`, `src/routes/platform.ts`, `scripts/platform-admin.ts`; cambios en `src/app.ts` (registro y estado del negocio en `authenticate`), `src/routes/auth.ts` (login/refresh), `src/booking/view.ts`, `src/routes/publicBooking.ts`, `src/routes/web.ts` (páginas públicas), `src/routes/subscriptions.ts` (concesión), `src/metrics.ts` (resumen), `src/config.ts`, `src/db/schema.ts`, `.env.example`, `package.json`.
- Compartido: `packages/shared/src/platform.ts`, `subscription.ts` (`accessGrantEndsAt`, aviso), `i18n.ts`.
- App: `src/app/platform/{_layout,index,audit}.tsx`, `src/app/platform/business/[id].tsx`, `src/ui/platform/{parts.tsx,strings.ts}`, `src/lib/platformApi.ts`; cambios en `src/lib/api.ts`, `src/lib/dashboard.ts`, `src/shell/WebShell.web.tsx`, `src/web/shell/routes.ts`.
- Pruebas: `apps/api/test/platform.test.ts`, `platformMigration.test.ts`, `packages/shared/test/platform.test.ts`; ajustes en `financeMigration.test.ts` e `indexes.test.ts` (ver §5).

## 4. Puesta en marcha (cuando decidas desplegar)

1. Definir `PLATFORM_ADMIN_KEY` (≥ 32 caracteres aleatorios) como secreto. Opcional: `PLATFORM_ADMIN_ALLOWED_IPS`.
2. `npm run db:migrate -w @xiro/api` (aplica 0037; aditiva).
3. `npm run platform:admin -w @xiro/api -- create --email <tu correo> --name "<tu nombre>" --founder` en el servidor. Guarda la contraseña mostrada y agrega el enlace `otpauth://` a tu app autenticadora. Se muestran una sola vez.
4. Entrar en `https://<dominio>/platform`.

## 5. Verificación realizada (resultados reales)

- `npm run typecheck` (4 paquetes) y `npm run lint`: sin errores.
- `apps/api/test/platform.test.ts`: **25/25**. Cubre: TOTP con el vector de la RFC 6238 y anti-repetición; secreto cifrado; meses calendario; panel inexistente sin clave; login (contraseña, código, cuenta inexistente, código repetido, admin desactivado); separación de tokens negocio/plataforma en ambos sentidos; ausencia de rutas para crear admins o darse permisos; permisos denegados auditados; logout e inactividad; MFA reciente obligatorio; bloqueo por fuerza bruta aunque cambie la IP; métricas comparadas contra conteos SQL directos; serie diaria con ceros reales y validaciones de rango/zona/inyección; búsqueda por correo (dueño y empleado), nombre, slug, id; conteo de empleados aislado entre dos negocios; ficha sin hashes ni correos completos; suspensión (sesiones abiertas, refresh, login, páginas públicas, auditoría con antes/después, reactivación); con el negocio suspendido no se reserva ni reprograma, pero el cliente ve y cancela su cita; aislamiento entre negocios al suspender; concesiones (sin tocar suscripción ni pagos, idempotencia, conflicto, revocación, 5 simultáneas encadenadas, meses tras período pagado, rango); concesión que no salta una suspensión; baja lógica con permiso propio, datos intactos y recuperación; bitácora inmutable y sin contraseñas/tokens.
- `platformMigration.test.ts`: la migración deja activos los negocios existentes; la reversión quita todo sin tocar negocios y se puede volver a aplicar.
- `packages/shared`: 122/122. `apps/mobile`: 760/761 (la que falla también falla sin estos cambios, ver abajo). `apps/public`: 117/117.
- Suite completa de la API (última corrida): 683 pasan, 8 fallan, y ninguna por este cambio: 6 de `exportPool` y 1 de disponibilidad en `booking.public` fallan igual en una copia limpia del commit base (hilos de trabajo y fechas en este entorno); 1 de reseñas en `booking.public` es frágil (busca el texto "573" en la respuesta y lo encontró dentro de un UUID aleatorio; pasa al repetirla). En otra corrida falló además `booking.page` (5 reservas simultáneas con la misma clave), intermitente también en el código base (falló 4 de 6 veces sin estos cambios).
- Ajustes de pruebas existentes: `financeMigration` e `indexes` revierten migraciones en orden; ahora deben revertir primero la 0037 (regla documentada en `docs/deploy.md`). En `indexes`, la API actual se ejecuta contra el esquema anterior a 0024; como `authenticate` lee `access_status` y **no** tolera su ausencia (fallaría abierta), la prueba agrega esa columna solo durante la comparación.
- Prueba manual en navegador (Chromium, web exportada, API local, base local con datos sintéticos): login con TOTP → resumen → búsqueda por correo → ficha → suspensión. Después: login del negocio `403 business_suspended`, catálogo público `404`, bitácora con el motivo.
- Rendimiento del panel con **20.003 negocios, 80.003 personas, 14.960 suscripciones, 59.840 pagos y 240.002 sesiones sintéticas** (1 proceso, PostgreSQL 16 local, 4 vCPU; 12 peticiones secuenciales por endpoint, p50 / máx en ms): resumen 30 días 63/86, resumen 12 meses 68/89, serie diaria 12 meses 19/22, serie semanal de pagos 43/49, serie mensual 16/26, búsqueda por correo 8/15, por nombre 25/32, ficha 17/19, bitácora 12/18. Planes de ejecución revisados: recorridos secuenciales sobre tablas de una fila por negocio o por pago (5–65 ms) y búsquedas puntuales por índice. **No se agregaron índices**: ninguna medición lo justifica hoy. Umbral propuesto: si `subscription_invoices` supera ~500.000 filas o la serie de pagos pasa de 300 ms, crear `subscription_invoices (created_at)` con `CREATE INDEX CONCURRENTLY`; si la búsqueda por nombre pasa de 300 ms, un índice de trigramas sobre `businesses.name`.
- **No comprobado**: compilación nativa (EAS) ni uso en un teléfono; el panel en Android/iOS usa los mismos componentes que el resto de la app, pero no se abrió en un dispositivo.

## 6. Riesgos, límites y pendientes

- **Capacidad de 5.000+ usuarios concurrentes: NO verificada.** El panel suma poca carga (≤ 1 resumen por minuto por administrador, ~7 consultas agregadas de < 100 ms), pero la capacidad del sistema completo requiere el plan de `docs/platform-loadtest-plan.md` en infraestructura representativa.
- Tráfico, errores, latencias y pool del panel son **de la instancia que responde**. Con varias instancias, usar Prometheus/Grafana.
- Con varias instancias sin Redis, los límites de intentos de login se multiplican por instancia (mismo límite conocido del resto de la API).
- Al suspender, un stream SSE de la Agenda ya abierto no se corta en el acto (no puede renovar su ticket ni hacer ninguna otra petición); y los recordatorios automáticos de citas ya agendadas se siguen enviando a sus clientes. Si se quiere otra cosa, es una decisión de producto pendiente.
- `access_status` se lee en cada petición autenticada (un `JOIN` por clave primaria, sin consulta extra). Revertir 0037 exige desplegar antes una versión anterior de la API.
- Pendientes de decisión: política de borrado definitivo (§2), si las páginas públicas de un negocio suspendido deben mostrar un aviso en lugar de 404, y si conviene exigir llaves de seguridad (WebAuthn) para el fundador además de TOTP.

## 7. Cómo revertir

- **Código**: revertir el commit (`git revert <commit>`), o desplegar la versión anterior.
- **Desactivar el panel sin tocar código**: quitar `PLATFORM_ADMIN_KEY` (todas las rutas responden 404). Los negocios suspendidos siguen suspendidos: reactívalos antes si es necesario.
- **Base de datos**: respaldo, desplegar la API anterior y luego `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/drizzle/rollback/0037_platform_admin.down.sql`. Borra las tablas del panel, incluida la bitácora (expórtala antes con `pg_dump --table=platform_audit_log`).
