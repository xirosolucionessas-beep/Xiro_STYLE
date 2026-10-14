# Código sin uso y deuda técnica (Fase 9 de la auditoría)

Fecha: 2026-10-14. **No se eliminó nada.** Regla del proyecto: no se borra ninguna función ni archivo sin permiso
explícito del dueño. Este documento clasifica los candidatos con su evidencia para que se decida.

## 1. Cómo se buscó

- **Archivos que nada importa:** se recorrieron las importaciones de los 700 archivos fuente del monorepo, resolviendo
  alias (`@/`, `@xiro/shared`) y variantes de plataforma (`.web`, `.native`, `.ios`, `.android`). Las rutas de expo-router,
  las pruebas, los scripts y los arranques cuentan como puntos de entrada.
- **Usos dinámicos:** a cada candidato se le revisó que no lo cargue un HTML (`<script>`), un service worker, un alias de
  Metro, un script de `package.json` o una carga perezosa.
- **Funciones sin uso:** exportaciones (funciones, constantes y clases) cuyo nombre no aparece en ningún otro lugar del
  monorepo, ni en su propio archivo.
- **Historial:** `git log -S` para saber cuándo se creó cada candidato y si alguna vez se usó.

## 2. No eliminar (se usan, aunque nada los importe)

| Archivo | Por qué se usa |
|---|---|
| `apps/api/public/catalog/catalog.js` | Lo carga el HTML del catálogo público (`<script src="/catalog-assets/catalog.js">`). |
| `apps/mobile/public/sw.js` | Service worker de las notificaciones push web (`navigator.serviceWorker.register('/sw.js')`). |
| `apps/mobile/scripts/gen-tokens-doc.ts` | Script `npm run docs:tokens`. |
| `apps/mobile/src/web/rn/Pressable.tsx`, `ActivityIndicator.tsx` | Metro los sustituye en la web por los de react-native-web (`metro.config.js`): accesibilidad y estados de carga. |
| `apps/api/src/assistant/reportsData.ts` | Servicio de reportes para el **asistente de IA** (2026-10-06): trabajo en curso de esta rama (`asistente-ia`), probado en `assistantReports.test.ts`, aún sin ruta. |
| `apps/mobile/src/web/shell/assistantContext.ts` · `useAssistant` | Parte del panel del asistente de IA (trabajo en curso). |
| `GET /expenses` (API) | Ya no lo usa la app actual (usa `GET /expenses/page`), pero lo necesitan las **versiones ya instaladas**. Se conserva a propósito (`docs/finance-listings.md`). |

## 3. Requiere verificación antes de decidir

| Elemento | Origen | Qué verificar |
|---|---|---|
| `apps/mobile/src/lib/purchases.native.ts` · `hasActiveEntitlement` | Estado base (2026-09-24) | Compras dentro de la app (suscripción): confirmar si el flujo de pago nativo lo va a usar. |
| `apps/api/src/subscriptions.ts` · `findExpiringSoon` | Estado base (2026-09-24) | Parece pensado para avisar de suscripciones por vencer (un trabajo programado que no existe aún). |

## 4. Eliminación potencialmente segura (con tu permiso)

Ninguno se usa en ningún lugar. Quitarlos no cambia ningún comportamiento; las pruebas y la revisión de tipos lo
confirmarían.

| Elemento | Origen | Nota |
|---|---|---|
| `apps/api/data/xiro.sqlite`, `xiro.sqlite-shm`, `xiro.sqlite-wal` | Prototipo anterior a PostgreSQL (20 de septiembre; sin rastro en el historial de Git) | Excluidos de Git y de la imagen; ningún código ni dependencia los usa y ningún proceso los tiene abiertos. Contienen el esquema viejo (`users`, `businesses`, `refresh_tokens`, `otp_codes`…). **Los datos están en el `-wal`**: se borran los tres juntos o ninguno. Recomendado: guardar primero una copia comprimida fuera del proyecto. |
| `apps/public/src/ui/Gallery.tsx` | Entrega B (2026-10-05) | El rediseño del 2026-10-13 la reemplazó por el carrusel y dejó de importarla. |
| `apps/mobile/src/lib/queries.ts` · `useExpenseList` | Módulo Finanzas (Fase 3) | Sin uso desde la paginación de Gastos (`useExpensePages`). `api.expensesList` queda solo para él. |
| `apps/mobile/src/lib/queries.ts` · `useExpenses` | 2026-10-05 | Hook anterior de gastos; sin uso. |
| `apps/mobile/src/lib/queries.ts` · `useInvalidateBooking`, `useOrder` | 2026-09-28 y 2026-10-12 | Sin uso. |
| `apps/mobile/src/lib/api.ts` · `fieldErrors` | Estado base | Ayuda de formularios; sin uso (se usa `apiErrors` de `lib/forms`). |
| `apps/mobile/src/web/mask.ts` · `looksLikeEmailInput`; `web/otp.ts` · `otpValue` | Estado base | Ayudas de la web; sin uso. |
| `apps/api/src/db/errors.ts` · `isCheckViolation`, `isRetryable`; `booking/time.ts` · `isTimezone` | Estado base | Ayudas genéricas; sin uso. Costo de conservarlas: casi nulo. |
| `packages/shared/src/booking.ts` · `slugInputSchema` | 2026-09-28 | Esquema sin uso (la comprobación de dirección usa otro). |

## 5. Deuda técnica observada (sin cambios)

- `GET /expenses` (versión anterior, hasta 1.000 filas) convive con `GET /expenses/page`. Se puede retirar cuando ninguna
  versión instalada de la app lo llame: conviene medirlo con los registros de acceso antes de decidir.
- Las rutas de Caja y Ventas usan la conexión directa o `withBusinessTrusted`: protegidas por el filtro de cada consulta,
  sin RLS de respaldo como el Balance (`docs/finance-authz.md`). Darles la misma segunda barrera sería un proyecto aparte,
  con migración y pruebas.
- Montos enteros en todo el sistema (decisión del producto, `docs/finance-rules.md`): si algún día se aceptan monedas con
  centavos, es un proyecto que toca precios, ventas, caja, reportes y descargas.
