# Capacidad medida — Xiro Style 2.0 (Fase 5)

Números **medidos**, no estimados, salvo donde se dice explícitamente "estimación". Fecha: 2026-10-11.

## 1. Cómo se midió

| | |
|---|---|
| Máquina | Portátil AMD Ryzen 5 5500U (6 núcleos / 12 hilos), 7,5 GB de RAM, Windows 11. **La API, PostgreSQL y el generador de carga comparten esta máquina.** |
| API | Un proceso, igual que en la imagen Docker (`node --import tsx src/server.ts`), logs JSON a archivo, pool de 10 conexiones, límites de abuso **activos** con sus valores de producción. |
| Diferencias con producción | Sin Redis (límites y caché en memoria del proceso: más rápido que Redis por red), sin TLS (lo termina Cloudflare/el balanceador), `NODE_ENV=development` porque producción exige Redis, R2 y proveedor de OTP. |
| Base | PostgreSQL 17 dedicado a la carga (`xiro_carga`), separado de la base de desarrollo. |
| Datos | 1 negocio grande con **20.000 clientes**, **5.000 artículos** (4.500 productos y 500 servicios) y 150 empleados; **200 negocios** con página de reservas publicada. Sembrados por la API real (`npm run load:seed`). |
| Herramienta | autocannon. Usuarios virtuales en **bucle cerrado** (piden sin pausa: mide el máximo que aguanta el servidor). Cada usuario llega con su propia IP (`X-Forwarded-For` + `TRUST_PROXY=1`) y acepta gzip, como la app real. |
| Latencias | P50/P95/P99 exactos de cada respuesta (no histogramas). Error = cualquier respuesta no 2xx (salvo 409 "horario ya tomado", que es la respuesta correcta) o sin respuesta. |
| Recursos | `/api/metrics` cada segundo: CPU y RAM del proceso de la API, conexiones del pool y peticiones esperando una conexión. |

Escenarios (20 s cada uno):

- **login**: `POST /api/auth/login` con cuentas distintas.
- **clientes**: lista paginada del negocio de 20.000 clientes. El 75 % navega páginas por cursor y el 25 % busca.
- **catálogo**: igual, sobre 5.000 artículos.
- **página pública**: lo que pide `/reservar` al abrirse (perfil, catálogo, equipo, reseñas, días y horarios), repartido entre los 200 negocios.
- **crear cita**: reserva pública real.
- **mixto**: 30 % página pública, 45 % listas, 10 % resumen, 7 % altas de clientes, 6 % reservas y 2 % logins. Se mide en escalones de 10, 50, 100 y 200 usuarios.

## 2. Resultados ANTES / DESPUÉS de las optimizaciones de la Fase 5

| Escenario | Usuarios | req/s antes → después | P50 ms antes → después | P95 ms antes → después | P99 ms antes → después | Errores | CPU API | Pool (máx / en espera) |
|---|---|---|---|---|---|---|---|---|
| login | 20 | 38,4 → 39,6 | 505 → 493 | 606 → 580 | 640 → 619 | 0 % | ~245 % | 10 / 0 |
| clientes (20k) | 50 | 266 → 275 | 183 → 178 | 236 → 223 | 279 → 248 | 0 % | ~125 % | 10 / 27 |
| catálogo (5k) | 50 | 181 → 185 | 267 → 265 | 348 → 335 | 383 → 387 | 0 % | ~121 % | 10 / 34 |
| **página pública** | 50 | **112 → 177 (+59 %)** | 477 → 331 | **624 → 429** | 716 → 493 | 0 % | ~110 % | 10 / 40 |
| crear cita pública | 20 | 54,9 → 56,5 | 360 → 343 | 418 → 429 | 469 → 536 | 0 % | ~107 % | 10 / 22 |
| mixto | 10 | **138 → 161 (+17 %)** | 49 → 41 | 187 → 155 | 234 → 202 | 0 % | ~125 % | 10 / 2 |
| mixto | 50 | **142 → 160 (+13 %)** | 325 → 302 | 564 → 540 | 628 → 619 | 0 % | ~126 % | 10 / 53 |
| mixto | 100 | **143 → 164 (+15 %)** | 686 → 560 | 1.075 → 1.047 | 1.198 → 1.143 | 0 % | ~127 % | 10 / 113 |
| mixto | 200 | 140 → 136 | 1.458 → 1.335 | 2.132 → 2.428 | 2.267 → 2.958 | 0 % | ~120 % | 10 / 233 |

Disponibilidad y días por separado (`/availability` y `/days`, 30 usuarios): **43 → 71 req/s (+65 %)**.

Todas las corridas sin un solo error ni timeout. El ruido entre corridas idénticas es de ±10 %: diferencias menores (login, clientes, catálogo, crear cita) son "igual". Con 200 usuarios la máquina completa está al 80 % de CPU (API + PostgreSQL + generador): esa fila mide el portátil más que la API.

Archivos con los datos crudos: `apps/api/data/carga/resultados-*.json` (no versionados).

## 3. Qué limita y qué se corrigió (perfiles de CPU bajo carga)

Se perfiló la CPU de la API **bajo carga** (`npm run load:profile`) antes de tocar nada:

| Hallazgo | Medida | Corrección | Efecto |
|---|---|---|---|
| Cálculo de horarios: cada franja convertía "fecha + hora local" a UTC con `Intl` varias veces | **28 % de la CPU** de `/availability` y `/days` en `tzOffset` | Memoria acotada en `zonedInstant` (`booking/time.ts`), mismo resultado exacto (prueba con 6 zonas, cambios de horario y medias horas) | disponibilidad +65 % |
| Página pública: 2 consultas por visita solo para saber si la página está publicada, y JSON de la caché parseado y vuelto a serializar | 2 idas a la base + parse/stringify por petición | 1 consulta (negocio + perfil unidos); el acierto de caché se envía tal cual (mismos bytes) | página pública +59 %, P95 −31 % |
| Cada transacción con negocio: `SET LOCAL ROLE` y `set_config` en dos idas a la base | 1 ida extra por transacción | Una sola sentencia (`set_config('role', …)` es el mismo GUC que `SET ROLE`; prueba de rol, negocio y reinicio al terminar) | incluido en las cifras de arriba |

**Lo que limita ahora** es la **CPU del hilo de Node**: ~120 % de CPU del proceso, con el event loop ocupado. En el perfil, el 18–27 % se va en drizzle-orm construyendo el SQL y mapeando filas. Comprobado con experimentos:

- **Pool de 20 conexiones en vez de 10**: igual o peor (clientes 253 req/s, mixto 134 req/s). Las peticiones esperan conexión porque el hilo está ocupado, no porque falten conexiones. **Se queda en 10.**
- **Sin compresión gzip**: dentro del ruido (de −5 % a +12 % según la ruta). **La compresión se queda**: ahorra datos móviles.
- **Login**: ~40 req/s por proceso, a propósito. argon2id cuesta ~50 ms por intento y se limitan 2 a la vez (`HASH_CONCURRENCY`), para que un pico de logins no ahogue al resto. Un pico de 1.000 logins tarda ~25 s en drenarse; con más de 200 en cola (`HASH_QUEUE_MAX`) la API responde 503 en vez de colapsar.

Lo que **no** se hizo, a propósito: reescribir consultas a SQL crudo o usar sentencias preparadas con nombre para esquivar el costo de drizzle. Es invasivo, arriesgado y rompe con PgBouncer en modo transacción. La forma correcta de crecer es **escalar horizontalmente**: la API no guarda estado y comparte límites y caché por Redis.

## 4. Seguridad bajo ataque (`npm run load:security`)

Contra el proceso real, con volumen de ataque. Termina con código 1 si algo falla. **14/14 superadas:**

| Ataque | Resultado |
|---|---|
| Fuerza bruta desde 1 IP (20 conexiones, ~11.000 intentos) | 99,9 % con 429; solo **10 contraseñas evaluadas**. Un usuario legítimo de otra IP: todo 200, P95 165 ms |
| Relleno de credenciales **distribuido** contra 1 cuenta (cada intento desde otra IP) | **Fallo encontrado y corregido**: con intentos simultáneos se evaluaban 19 contraseñas (2× el máximo). Ahora el intento se reserva de forma atómica antes de verificar: **10 exactas**. Prueba unitaria nueva: 20 simultáneos con máximo 2 → 2 evaluados (antes 20) |
| Spam de reservas desde 1 IP | Bloqueado tras el máximo por hora (99,8 % con 429) |
| ~8.000 peticiones con tokens forjados | 100 % 401, ningún dato expuesto; el usuario legítimo sigue atendido (P95 303 ms) |
| Cuerpo de 3 MB / JSON con 50.000 niveles / JSON roto | 413 / 400 / 400 sin detalles internos; el servidor sigue vivo |
| Cabeceras | nosniff, CSP, `X-Frame-Options: DENY`, sin `X-Powered-By`, `X-Request-Id` en cada respuesta |

**Riesgo de producto pendiente de decisión**: el límite de la página pública es de **240 peticiones por minuto por negocio**, sumando todas las IP. Abrir la página son ~6 peticiones, o sea **~40 visitantes por minuto por negocio**. Medido con un negocio "viral": 240 respuestas y 29.143 respuestas 429 en 20 s. El rechazo es barato (1.469 req/s, P50 12 ms), así que como defensa funciona, pero un negocio que comparta su enlace en redes perdería visitas.

## 5. App móvil con 5.000 clientes

- La lista es una `FlatList` virtualizada y paginada por cursor (50 por página; `initialNumToRender` 15, `windowSize` 11, `removeClippedSubviews`): solo existen en memoria las filas cercanas a la pantalla.
- **Fallo encontrado y corregido**: "deslizar para actualizar" volvía a descargar **todas** las páginas ya vistas, una tras otra (comportamiento de TanStack Query). Con 5.000 clientes vistos eran **100 peticiones en serie**. Ahora recarga solo la primera página, sin dejar la lista vacía ni un instante (`refreshFromStart`, en clientes, catálogo e inventario). Prueba: 100 → 1 petición.
- Las filas aplanadas se memorizan (`useMemo`): escribir en el buscador ya no recorre las 5.000 filas en cada tecla.
- **No medido**: los FPS reales en un teléfono. Requiere un dispositivo físico. Procedimiento: compilación de release, cuenta con 5.000 clientes (`load:seed` contra la base de staging), *Perf Monitor* de React Native y desplazarse hasta el final; aceptable ≥ 55 FPS en JS y UI en un Android de gama media.

## 6. Capacidad real y recomendación de infraestructura

**Medido**: un proceso de la API, en el equivalente a ~1 núcleo de este portátil, sostiene **~160 peticiones/s de tráfico mixto, sin errores y con P95 ≈ 0,15 s (10 usuarios) a 0,55 s (50 usuarios)**. La página pública sostiene ~177 req/s y el login ~40/s.

**Estimación (no medida)**: una persona real no pide sin pausa. Con una petición cada ~10 s de uso activo, 160 req/s equivalen a **~1.500 personas usando la app a la vez por proceso**. Es una extrapolación del rendimiento medido, no una prueba con 1.500 usuarios reales. **No afirmo que aguante 15.000 usuarios concurrentes**: eso pediría ~10 procesos y una base dimensionada para ese volumen, y habría que medirlo en la infraestructura real.

Punto de partida recomendado (cuando se elija proveedor):

| Pieza | Inicio | Cuándo crecer |
|---|---|---|
| API | **2 instancias** (alta disponibilidad) de 1 vCPU y 1 GB, `NODE_OPTIONS=--max-old-space-size=768`, `MAX_HEAP_USED_MB=600` | +1 instancia cuando el P95 pase de 1 s o la CPU media supere el 70 % (alertas de `docs/deploy.md`) |
| PostgreSQL | Gestionado, 2 vCPU / 4 GB, con PITR. `max_connections` ≥ instancias × 10 + 20 | Al pasar de ~6 instancias, PgBouncer (ya soportado, `docs/database-pooling.md`) |
| Redis | Gestionado, el plan más pequeño (solo límites y caché) | Rara vez |
| Cloudflare | Delante de todo (TLS, WAF, DDoS) | — |

**Antes de lanzar**: repetir estas mismas pruebas en el entorno elegido. Una vCPU de servidor suele rendir menos que un núcleo de este portátil, y la base irá por red, así que las cifras pueden bajar.

## 7. Reproducir

```bash
npm run load:db -w @xiro/api          # PostgreSQL de carga (otra terminal, se queda corriendo)
npm run load:seed -w @xiro/api        # siembra (~1,5 min); --reset para empezar de cero
npm run load:run -w @xiro/api -- --label prueba             # todos los escenarios
npm run load:run -w @xiro/api -- --label x --only mixto --steps 10,50,100 --duration 30
npm run load:profile -w @xiro/api -- --scenario disponibilidad   # perfil de CPU (abre el .cpuprofile en Chrome DevTools)
npm run load:security -w @xiro/api    # seguridad bajo ataque (código 1 si algo falla)
```

Variables: `LOADTEST_ADMIN_URL` para usar otro PostgreSQL (por ejemplo, uno igual al de producción) y `LOADTEST_API_ENV='{"DB_POOL_MAX":"20"}'` para probar otra configuración de la API.
