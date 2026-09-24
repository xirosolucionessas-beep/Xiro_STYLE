# Xiro Style 2.0

Gestión de negocios de belleza (barberías, salones, spas) para **Android, iOS y Web** con una sola base de código, un backend propio y un catálogo público compartible por WhatsApp.

Es la evolución de la app Android nativa (`../XIRO_STYLE`, Kotlin/Compose): mismo producto y misma marca, ahora multiplataforma y con datos reales persistidos en un servidor.

## Arquitectura

```
apps/
  api/      Fastify 5 + PostgreSQL (Drizzle ORM) · auth, negocio, catálogo/inventario, clientes,
            catálogo público (API + página web) y hosting de la app web exportada
  mobile/   Expo SDK 57 (React Native) + expo-router · iOS, Android y Web desde el mismo código
packages/
  shared/   Esquemas Zod, tipos, reglas de stock, teléfonos, moneda y traducciones ES/EN
            (única fuente de verdad: la API valida con lo mismo que usa la app)
```

Decisiones clave

- **Un solo lenguaje (TypeScript)** en servidor, móvil y web: los tipos y la validación se comparten, no se duplican.
- **iOS desde Windows**: Expo permite compilar iOS en la nube (EAS Build) sin Mac. (Kotlin Multiplatform habría exigido un Mac.)
- **Datos públicos vs. internos**: el catálogo público sale de una lista blanca explícita (`toPublicItem`); costo, stock, notas, referencia, usuarios y clientes nunca se exponen. Hay pruebas que lo verifican.
- **Multi-negocio**: cada negocio tiene su `slug`; todo dato privado está aislado por `business_id`.
- **Sesiones**: access token JWT de 15 min + refresh token rotativo (un solo uso, guardado hasheado). En móvil se guarda en Keychain/Keystore (`expo-secure-store`).
- **Base de datos**: PostgreSQL con Drizzle ORM (UUID, `timestamptz`, restricciones `CHECK`/FK en la propia base, índices para las consultas frecuentes). Las migraciones versionadas están en `apps/api/drizzle`.
- **Concurrencia**: las operaciones que deben ser atómicas lo son en la base de datos, no en el código (ver "Seguridad y concurrencia").
- **Recuperación de acceso** por OTP de 6 dígitos (10 min, 5 intentos, respuesta idéntica exista o no la cuenta) → token de restablecimiento → cierra todas las sesiones.

## Requisitos

- Node.js ≥ 22.13
- PostgreSQL 14+ (en desarrollo: `npm run db:dev -w @xiro/api` levanta uno local sin instalar nada, o `docker compose up -d`)
- Para móvil: la app **Expo Go** o un emulador. Para publicar: cuenta de Expo (EAS).

## Puesta en marcha

```bash
npm install

# 1) API (http://localhost:3000)
cp apps/api/.env.example apps/api/.env      # ajusta JWT_SECRET, etc.
npm run db:dev -w @xiro/api                  # PostgreSQL local (o: docker compose up -d); déjalo corriendo
npm run dev:api                              # en desarrollo aplica las migraciones al arrancar

# 2) App (otra terminal)
npm run dev:mobile      # QR para Expo Go / a = Android / i = iOS / w = web
```

En desarrollo la app detecta la IP de tu PC para hablar con la API. Para apuntar a otro servidor:
`EXPO_PUBLIC_API_URL=https://api.tudominio.com` (ver `apps/mobile/.env.example`).

### Web en producción (un solo servicio)

```bash
npm run build:web                 # exporta la app web a apps/mobile/dist
export NODE_ENV=production JWT_SECRET=<32+ caracteres> DATABASE_URL=postgres://usuario:clave@host:5432/xiro \
       CORS_ORIGINS=https://app.tudominio.com TRUST_PROXY=1 WEB_DIR=../mobile/dist
npm run db:migrate -w @xiro/api   # paso de despliegue: aplica las migraciones pendientes (repetible y seguro con concurrencia)
npm run start -w @xiro/api        # sirve API + web + catálogo público
```

- App web: `/`
- Catálogo público de un negocio: `/catalog/<slug>` y `/catalog/<slug>/item/<id>` (con vista previa Open Graph para WhatsApp)
- API pública: `GET /api/public/catalog/<slug>` y `GET /api/public/catalog/<slug>/items/<id>`

### Builds nativos

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview     # se compila en la nube, no requiere Mac
```

Ajusta `bundleIdentifier` / `package` en `apps/mobile/app.json` (`com.xirostyle.app` es un valor por defecto).

## Calidad

```bash
npm run check    # typecheck + lint + pruebas (shared, API y app)
```

Las pruebas de la API se ejecutan contra un **PostgreSQL 18 real** (binarios oficiales efímeros, una base aislada por archivo de pruebas; con `TEST_DATABASE_URL` usan tu servidor, p. ej. un servicio de CI). Cubren autenticación, rotación de tokens, recuperación por OTP, aislamiento entre negocios, subida y validación de imágenes (por firma real del archivo), y que el catálogo público jamás filtre datos internos, además de:

- **Concurrencia** (`test/concurrency.test.ts`): registros duplicados simultáneos, rotación de refresh tokens, intentos de OTP, ventas simultáneas sobre poco stock, subidas de fotos en paralelo, etc.
- **Seguridad** (`test/security.test.ts`): tokens JWT falsificados, cabeceras, CORS, límites de peticiones, inyección SQL/XSS, validación y restricciones de la base de datos.

## Seguridad y concurrencia

**Entradas**: todo payload, parámetro y query se valida con Zod (esquemas compartidos); las consultas usan parámetros enlazados (nunca se concatena SQL), los `LIKE` escapan `%` y `_`, se rechazan campos desconocidos y el carácter NUL, los ids que no son UUID responden 404 y el HTML del catálogo público escapa todo el contenido.

**Sesiones**: access token HS256 (algoritmo fijado; se rechaza `none`), con emisor, audiencia y caducidad obligatorios (15 min). Además de la firma se comprueba que el usuario exista, que el token sea de su negocio y que sea posterior al último cambio de contraseña. Refresh token opaco, guardado hasheado, de un solo uso y con **detección de reutilización**: si un token ya usado reaparece (tras 10 s de gracia por pestañas simultáneas) se revoca toda su familia. Se mantiene el esquema `Authorization: Bearer` (la app nativa no usa cookies); al no haber cookies de sesión no hay superficie CSRF.

**Límites de peticiones** (no se pueden desactivar en producción): por IP en toda la API, por usuario autenticado (aunque cambie de IP), por IP en registro/login/refresh/recuperación, y **por cuenta** contra fuerza bruta (N fallos en la ventana bloquean el login aunque el atacante rote de IP; un acierto reinicia el conteo). Devuelven 429 con `Retry-After`.

**Cabeceras**: Helmet con CSP estricta (sin scripts en línea ni de terceros), `frame-ancestors 'none'`, HSTS en producción, `nosniff`, Referrer-Policy y Permissions-Policy; `Cache-Control: no-store` en lo privado. CORS solo con los orígenes exactos de `CORS_ORIGINS` (sin `*`, y https obligatorio en producción). En producción la API se niega a arrancar con una configuración insegura (secreto corto, OTP de desarrollo, límites apagados, CORS abierto, sin `DATABASE_URL`).

**Concurrencia**: cada regla se hace cumplir en la base de datos, no con lecturas-luego-escritura sin protección:

| Riesgo | Mecanismo |
|---|---|
| Dos registros con el mismo correo/teléfono | Índices únicos → 409 |
| Dos negocios con el mismo nombre | `slug` único con reintento dentro de la transacción |
| Refresh token usado dos veces / OTP adivinado en paralelo | `UPDATE … WHERE … RETURNING` (un único ganador) |
| Ventas simultáneas que dejan el stock en negativo | `POST /api/items/:id/stock-adjustments` con `stock = stock + delta` y `CHECK (stock >= 0)` → 409 `insufficient_stock` |
| Dos dispositivos editando el mismo artículo | `expectedUpdatedAt` opcional en `PUT /api/items/:id` → 409 `conflict` |
| Más de 4 fotos por subidas paralelas | Bloqueo de fila (`FOR UPDATE`) |
| Artículo con categoría de otro negocio, o categoría borrada a la vez | FK compuesta `(category_id, business_id)` |
| Doble apertura de caja el mismo día | `ON CONFLICT DO UPDATE` sobre `(business_id, day)` |

**Limitación conocida**: los contadores por usuario y por cuenta viven en la memoria de cada instancia. Con **una** instancia son exactos; con varias, el tope efectivo se multiplica por el número de instancias. Si escalas horizontalmente, el siguiente paso es un almacén compartido (Redis) para esos contadores; el límite por IP ya admite un almacén Redis en `@fastify/rate-limit`.

## Variables de entorno

Referencia completa y comentada en `apps/api/.env.example`. Las principales:

| Variable | Dónde | Descripción |
|---|---|---|
| `DATABASE_URL` | api | **Obligatoria en producción.** `postgres://usuario:clave@host:5432/base` |
| `DATABASE_SSL` | api | `disable` \| `require` \| `no-verify` (por defecto `require` en producción) |
| `DB_POOL_MAX` / `DB_POOL_MIN` | api | Tamaño del pool (10 / 0). Instancias × máximo < `max_connections` |
| `DB_CONNECTION_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` / `DB_IDLE_TIMEOUT_MS` | api | Esperas del pool y de las consultas (5 s / 15 s / 30 s) |
| `AUTO_MIGRATE` | api | Migrar al arrancar (por defecto solo en desarrollo) |
| `JWT_SECRET` | api | Obligatorio en producción (≥ 32 caracteres) |
| `JWT_ISSUER` / `JWT_AUDIENCE` / `JWT_ACCESS_TTL` | api | Emisor, audiencia y vida del access token (15m) |
| `CORS_ORIGINS` | api | Orígenes web permitidos, exactos y separados por coma |
| `RATE_LIMIT`, `RATE_LIMIT_*` | api | Activación y topes (IP, usuario, autenticación, cuenta) |
| `SECURITY_CSP`, `SECURITY_HSTS`, `CSP_CONNECT_SRC`, `CSP_IMG_SRC` | api | CSP/HSTS y orígenes extra permitidos |
| `DATA_DIR` | api | Carpeta de las fotos subidas (`./data`) |
| `WEB_DIR` | api | Carpeta de la web exportada |
| `TRUST_PROXY` | api | Número de saltos de proxy confiables (p. ej. `1`). Evita `true` |
| `EXPOSE_DEV_OTP` | api | **Solo desarrollo**: devuelve el OTP en la respuesta (se rechaza en producción) |
| `EXPO_PUBLIC_API_URL` | mobile | URL de la API |
| `EXPO_PUBLIC_PUBLIC_URL` | mobile | Base de los enlaces compartidos (por defecto, la API) |
| `EXPO_PUBLIC_SUPPORT_WHATSAPP` | mobile | Número de soporte (si falta, se oculta la opción) |

## Base de datos: operación

- **Migraciones**: `npm run db:generate -w @xiro/api` genera una nueva a partir de `src/db/schema.ts`; `npm run db:migrate -w @xiro/api` las aplica (con bloqueo consultivo: varias instancias arrancando a la vez no chocan). Revisa el SQL generado antes de versionarlo.
- **Datos de la versión SQLite**: no se incluye script de copia SQLite → PostgreSQL porque esa base solo contenía datos de desarrollo (V2 no se había desplegado). El archivo `apps/api/data/xiro.sqlite` puede borrarse.
- **Backups**: usa los del proveedor de PostgreSQL (o `pg_dump`) y prueba la restauración periódicamente.
- **Salud**: `GET /api/health` (proceso vivo) y `GET /api/health/ready` (comprueba la base de datos; 503 si no responde) para el balanceador.

## Estado y pendientes

Migrado desde la app Android: autenticación y recuperación, datos del negocio (horarios, logo), inicio con base de caja, inventario (stock, costos, estados, filtros), catálogo (fotos, publicación, categorías), compartir por WhatsApp, clientes, idioma ES/EN y modo oscuro/claro.

**Pendiente / decisiones abiertas**

1. **Envío real del OTP**: `apps/api/src/notifier.ts` es la interfaz; por defecto solo imprime el código en el log. Falta conectar un proveedor (WhatsApp Cloud API, Twilio, correo).
2. **Módulos que en la app original eran maquetas** y aquí figuran como "Próximamente": citas, cierre de caja, equipo y asistente de voz/IA.
3. **Verificación en dispositivos**: se comprobó en navegador (E2E) y que los bundles de iOS/Android compilan, pero no se ha probado en un teléfono/emulador ni compilado con EAS.
4. **Datos de la app anterior**: al ser todo local (SharedPreferences/memoria) no hay nada que migrar; los usuarios empiezan cuenta nueva.
5. **Almacenamiento de fotos** en disco local: para varias instancias del servidor conviene moverlo a S3/R2.
6. **Rate limiting compartido**: ver "Limitación conocida" en Seguridad y concurrencia.
7. **`docker-compose.yml`** no se ha podido probar en este entorno (sin Docker); `npm run db:dev` sí está verificado.
