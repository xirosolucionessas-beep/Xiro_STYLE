# Concurrencia del cierre de caja

Fecha: 2026-10-13. Código: `apps/api/src/booking/cashLock.ts`. Pruebas: `apps/api/test/cashConcurrency.test.ts`.

## 1. El problema

El cierre de caja (`POST /cash/close`) calcula el resumen del día y lo firma (lo guarda) dentro de una transacción. Las
operaciones que el cierre cuenta comprueban por separado si el día está cerrado y después escriben:

- alta, edición y anulación de gastos (`/expenses`);
- alta y anulación de ventas (`/sales`).

Con el aislamiento por defecto de PostgreSQL (READ COMMITTED), según el orden en que confirman las transacciones:

- **A.** La operación ya comprobó "caja abierta" y todavía no confirma cuando el cierre calcula su resumen. El cierre no la
  ve, la operación confirma después y **el cierre firmado no la refleja**. Ejemplo reproducido: un gasto de $12.000
  pagado desde caja quedaba registrado, pero el cierre firmaba $100.000 de efectivo esperado en lugar de $88.000.
- **B.** El cierre ya calculó su resumen y todavía no confirma cuando llega la operación. La operación ve "caja abierta"
  (el cierre aún no es visible), **acepta un gasto desde caja en un día que se está cerrando** y el cierre firma sin él.

Antes de la corrección, 6 de los 7 escenarios de la prueba fallaban. Dos cierres simultáneos del mismo día ya estaban
protegidos por el índice único `cash_closings_business_day_active_uq` (uno se firma y el otro recibe 409).

## 2. Comportamiento acordado

| Operación | Mientras se está cerrando ese día | Con el día ya cerrado |
|---|---|---|
| Alta de gasto **pagado desde caja** | Espera al cierre y luego recibe 409 `expense_day_closed` | 409 `expense_day_closed` (sin ajuste: se registra como "no pagado desde caja") |
| Edición o anulación de un gasto pagado desde caja | Espera al cierre y luego exige el ajuste con motivo (409 `adjustable: true`) | Solo con ajuste y motivo, que queda registrado (antes/después) |
| Gasto **no** pagado desde caja (transferencia, tarjeta…) | Espera al cierre y luego se registra | Se permite como hasta ahora (no toca el efectivo de la caja). **Decisión del producto: sin cambios.** |
| Venta, o anulación de una venta | Espera al cierre y luego se registra | Se permite como hasta ahora. **Decisión del producto: permitir y mostrarlo aparte.** |
| Segundo cierre del mismo día | Espera y luego recibe 409 `already_closed` | 409 `already_closed` |

Una operación que **empezó antes** que el cierre entra completa en el cierre: el cierre la espera.

**El cierre firmado nunca cambia.** Lo que pase en ese día después de firmarlo (ventas nuevas o anuladas, ajustes de gastos
desde caja) se muestra aparte:

- La API agrega al resumen del día (`GET /cash/close-summary` y el detalle de un cierre) el campo
  `afterClose: { closedAt, closedSales, closedExpectedCash, salesDelta, expectedCashDelta } | null`. Las diferencias son
  lo de ahora menos lo firmado, así que también funcionan con los cierres hechos antes de este cambio, y no hace falta
  migración. El campo es nuevo: no se quitó ni se renombró nada del contrato.
- El Cierre de caja (web y Android/iOS) y la tarjeta "Flujo de caja diario" del Inicio muestran, por ejemplo:
  "Después del cierre: ventas +$30.000 · efectivo esperado +$30.000. El cierre firmado no cambia."

## 3. Estrategia de serialización

Un candado de PostgreSQL (`pg_advisory_xact_lock`) por **(negocio, día)**, con alcance de transacción: se libera solo al
confirmar o revertir, también si algo falla.

- Ventas y gastos lo toman **compartido** (`pg_advisory_xact_lock_shared`). Entre ellos no se bloquean, así que el ritmo
  normal de trabajo no cambia.
- El cierre lo toma **exclusivo** (`pg_advisory_xact_lock`). Espera a las operaciones en curso de ese día, y las que
  llegan mientras tanto esperan a que confirme.
- Se toma al **principio** de cada transacción, antes de comprobar si el día está cerrado. Al seguir, cada operación ya ve
  el cierre confirmado y aplica sus reglas.
- El día de una venta se calcula en la base con `now()` (el mismo reloj que guarda `created_at`) y la zona horaria del
  negocio. Una anulación usa el día en que se vendió. Un gasto usa su fecha de gasto; al editarlo se toman la fecha de
  antes y la de ahora.

**Interbloqueos:** no se pueden formar. El cierre toma un solo candado. Quien toma varios días (editar la fecha de un gasto)
los toma en orden ascendente. Los candados de fila existentes (`FOR UPDATE` del gasto o de la venta) se toman antes del
candado del día y el cierre no toma candados de fila.

**Impacto:** una venta o un gasto solo espera si en ese mismo momento se está firmando el cierre de **ese** día de **ese**
negocio. Esa espera dura lo que tarda el cierre (milisegundos). Los demás negocios y días no se ven afectados. Cada
operación hace una consulta más (`select pg_advisory_xact_lock_shared(...)`), sin escritura.

**Fuera del alcance:** la anulación de un cierre (`POST /cash/closings/:id/void`) no toma el candado. Anularlo solo cambia
su estado, y lo que se registre después del cierre anulado ya se permite.

## 4. Pruebas (`test/cashConcurrency.test.ts`)

Para reproducir la carrera de forma determinista, un trigger de la base de **prueba** vuelve lenta una operación
concreta (`pg_sleep`, marcada con un valor especial) y la otra se lanza mientras tanto.

- **A** (la operación está en curso cuando entra el cierre): alta, edición y anulación de un gasto desde caja; venta en
  efectivo; anulación de una venta. El cierre firmado coincide con lo registrado.
- **B** (el cierre está en curso): un gasto desde caja recibe 409; una anulación de gasto exige el ajuste; una venta se
  registra y queda "después del cierre", con el cierre sin cambios y la diferencia explicada; dos cierres simultáneos
  dan 201 + 409 y un único cierre en la base.
- **Ráfaga:** 10 ventas y 6 gastos simultáneos con un cierre en medio. Ninguna operación se pierde ni se cuenta dos
  veces, lo firmado es un subconjunto coherente y el efectivo esperado cuadra.
