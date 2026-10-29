# Plan de pruebas de carga: objetivo de más de 5.000 usuarios concurrentes

**Estado: plan, no ejecutado.** Hoy NO hay evidencia de que Xiro Style soporte 5.000 usuarios concurrentes. Lo medido (docs/capacity.md, un portátil, un proceso) es ~160 peticiones/s de tráfico mixto por proceso. Esta meta solo se dará por cumplida con resultados reproducibles que cumplan los umbrales de §4 en infraestructura representativa. **Nunca contra producción sin autorización escrita.**

## 1. Definiciones (para no mezclar cifras)

| Término | Definición | Fuente hoy |
|---|---|---|
| Usuario registrado | Fila en `users` (dueño o empleado) o `client_accounts` | Base de datos |
| Usuario activo diario | Persona con al menos una petición autenticada en el día | **No se mide hoy** (requiere instrumentación) |
| Usuario concurrente (la meta) | Persona con la app abierta que hizo una operación en los últimos 60 s y seguirá haciendo operaciones | **No se mide hoy** |
| Conexión abierta | Socket TCP/keep-alive o stream SSE de la Agenda | Balanceador / `/api/metrics` |
| Usuario autenticado | Tiene un token válido; puede estar inactivo | No implica carga |

La meta se mide como **5.000 usuarios virtuales concurrentes con el perfil de actividad de §2**, no como 5.000 conexiones ni 5.000 peticiones/s.

## 2. Perfil de actividad (supuestos explícitos, a reemplazar con datos reales)

No existen datos de uso real: estos supuestos deben revisarse con la telemetría de producción (proponer: contador de usuarios activos en Redis por ventana de 1 min, y el histograma de `/api/metrics` en Prometheus).

| Rol | % de usuarios | Pausa entre operaciones | Mezcla |
|---|---|---|---|
| Dueño/empleado en la web | 35 % | 8–20 s | 45 % listas paginadas (clientes, catálogo, agenda), 15 % inicio/resumen, 10 % ventas (escritura), 8 % citas (escritura), 7 % altas de clientes, 5 % exportaciones PDF/Excel (máx. 1 cada 5 min), 10 % otros |
| Dueño/empleado en Android/iOS | 25 % | 8–20 s | Igual que web, más refresco de agenda y push |
| Cliente final en la página pública | 38 % | 3–10 s | Perfil, catálogo, equipo, reseñas, disponibilidad/días; 6 % crea reserva o pedido |
| Sesiones / login | 1,5 % | — | Login (argon2, caro), refresh cada 15 min por usuario activo |
| Panel del fundador | ≤ 0,1 % | 60 s | Resumen y series; búsquedas ocasionales |

Con estos supuestos, 5.000 concurrentes ≈ 350–600 peticiones/s sostenidas (a confirmar en la línea base). Incluir **aislamiento entre negocios**: usuarios repartidos en ≥ 2.000 negocios de tamaños realistas (1 grande de 20.000 clientes, la mayoría de < 500).

## 3. Entorno y etapas

- Entorno **aislado** igual a producción en tamaños (instancias de API, PostgreSQL gestionado, Redis, almacenamiento S3/R2, balanceador/Cloudflare en modo de prueba). Base sembrada con `npm run load:seed` ampliado; jamás datos reales.
- Generador de carga en máquinas **separadas** de la API (k6 o autocannon distribuido), con IPs/`X-Forwarded-For` repartidas para no medir el límite por IP en lugar de la API.
- Proveedores externos (Stripe, PayPal, RevenueCat, Google, OTP) sustituidos por simuladores con latencia configurable; nunca llamadas reales.

| Etapa | Usuarios virtuales | Duración | Qué valida |
|---|---|---|---|
| Línea base | 100 → 500 | 10 min por escalón | Latencias de referencia, consumo por usuario |
| Aumento gradual | 1.000, 2.000, 3.000, 4.000, 5.000, 6.000, 7.500 | 15 min por escalón | Punto de saturación y margen sobre 5.000 |
| Ráfaga | de 2.000 a 6.000 en 60 s | 10 min | Escalado, colas (argon2, exportaciones), 503 controlados |
| Resistencia | 5.000 | 4 h | Fugas de memoria, crecimiento de conexiones, tablas/índices |
| Recuperación | 5.000 con caída de 1 instancia de API, reinicio de Redis y failover de PostgreSQL | 30 min | Tiempo de recuperación, operaciones duplicadas o perdidas |
| Aislamiento | 5.000, con un negocio "viral" a 20× | 15 min | Que un negocio no degrade a los demás (límite por negocio) |

## 4. Métricas y umbrales (definidos ANTES de probar)

| Métrica | Umbral de aprobación a 5.000 concurrentes |
|---|---|
| Latencia de lecturas | p50 ≤ 150 ms, p95 ≤ 500 ms, p99 ≤ 1.000 ms |
| Latencia de escrituras (ventas, citas, clientes) | p95 ≤ 800 ms, p99 ≤ 1.500 ms |
| Login | p95 ≤ 1.500 ms (argon2 es caro a propósito); 503 controlado bajo ráfaga, sin errores 5xx de otro tipo |
| Errores | 5xx (salvo 503 de sobrecarga en ráfaga) < 0,1 %; 4xx inesperados = 0 |
| Operaciones duplicadas o perdidas | 0 (verificado en la base al terminar: citas, ventas, existencias, concesiones) |
| CPU de la API | media < 70 % por instancia; memoria estable en la prueba de 4 h (crecimiento < 10 %) |
| PostgreSQL | CPU < 70 %, conexiones < 80 % de `max_connections`, espera del pool (`xiro_db_pool_waiting`) p95 < 5, sin bloqueos > 1 s, consultas p95 < 100 ms |
| Redis | Latencia p99 < 5 ms |
| Servicios externos simulados | Su latencia no debe bloquear peticiones no relacionadas |
| Recuperación | Vuelta a los umbrales < 2 min tras la caída de una instancia; failover de base < 5 min, sin datos perdidos |
| Aislamiento | El negocio viral recibe 429; el p95 del resto no empeora > 20 % |

Medir también: peticiones/s y operaciones completadas por tipo, red de entrada/salida, demora del event loop, cola de hashing y de exportaciones.

## 5. Riesgos conocidos a vigilar (del código actual)

- Login: ~40 por segundo por proceso por diseño (argon2id, `HASH_CONCURRENCY=2`).
- CPU del hilo de Node (drizzle) es el límite medido; escalar horizontalmente es el camino previsto. Pool de 10 por instancia; instancias × 10 + margen < `max_connections` (o PgBouncer, `docs/database-pooling.md`).
- Límites de abuso por usuario y por cuenta en memoria del proceso si Redis no está configurado: con varias instancias los topes se multiplican.
- Stream SSE de la Agenda: cada pestaña abierta es una conexión larga y una suscripción LISTEN.
- Exportaciones PDF/Excel en hilos con cola acotada.
- Página pública: 240 peticiones/min por negocio (riesgo de producto ya documentado en `docs/capacity.md`).

## 6. Panel del fundador dentro de la prueba

Medido en local con 20.003 negocios (ver `docs/platform-admin.md` §5): todas sus lecturas entre 8 y 90 ms. Durante la prueba de 5.000, mantener 2 administradores con el panel abierto (resumen cada 60 s y series al cambiar filtros) y comprobar que el p95 de los negocios no cambia con y sin el panel.

## 7. Entregable de cada corrida

Fecha, commit, configuración exacta de infraestructura, datos sembrados, script y perfil usados, resultados crudos (JSON) y tabla contra los umbrales de §4 con "cumple / no cumple". Solo una corrida completa que cumpla todos los umbrales, repetida al menos dos veces con resultados dentro de ±10 %, permite afirmar la capacidad.
