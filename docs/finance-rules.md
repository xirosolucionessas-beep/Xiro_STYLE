# Reglas financieras

Fecha: 2026-10-13. Prueba de conciliación con valores conocidos: `apps/api/test/financeRules.test.ts`.

Todos los montos son **pesos enteros** en todo el sistema (precios, ventas, caja, gastos, reportes y descargas), también
para negocios en USD o EUR. Las fechas son **días locales del negocio**, según su zona horaria (`America/Bogota` por
defecto).

## 1. Ventas

- **Total de una venta = subtotal − descuento + propina.** Los pagos (uno o varios métodos) deben sumar exactamente ese
  total. El descuento no puede pasar del subtotal.
- Cada línea genera un **registro de servicio** por su valor antes del descuento. El descuento queda en la venta.
- **Anular una venta** (solo el dueño, con motivo) la saca de todo: caja, balance y reportes. Sus registros quedan
  marcados como anulados (no se borran) y los productos vuelven al inventario.

## 2. Descuentos

- **En ventas:** el balance resta el descuento de la venta (servicios + productos − descuentos). Nunca se resta dos veces.
- **En reservas (códigos de descuento):** al completar la cita se registra **lo cobrado** (total menos el descuento,
  repartido entre las líneas en proporción a su valor). Como no hay venta, no hay nada más que restar
  (`discounts.test.ts`).

## 3. Propinas

- Son del **personal**: el balance no las cuenta como ingreso del negocio y las muestra aparte.
- En la **caja** sí entran, porque se cobraron: las ventas de caja y el efectivo esperado las incluyen. El Inicio lo dice
  ("Incluye $X de propinas").

## 4. Citas completadas y servicios registrados a mano (decisión del producto)

- Cuentan como **ingreso** en el Balance y en el Inicio ("Ventas hoy").
- **No tienen método de pago**, así que **no entran** en las ventas ni en el efectivo esperado de la caja, ni en el cierre
  firmado.
- Para explicar la diferencia, el Cierre de caja y la tarjeta "Flujo de caja diario" muestran aparte: "Cobros sin venta
  registrada (citas completadas o servicios registrados a mano): $X. No suman a las ventas ni al efectivo de la caja."
  (campo `unbilledRecords` del resumen del día).

**Conciliación:** ingresos del balance = ventas de caja − propinas + cobros sin venta. Gastos del balance (operativos +
nómina) = gastos de caja del mismo día.

## 5. Gastos

- **Tipos:** operativos y nómina. La nómina exige un beneficiario del propio negocio.
- **Nómina a un empleado inactivo:** **permitida** (liquidaciones, primas o pagos pendientes; decisión del producto). El
  formulario lo muestra después de los activos, marcado "(inactivo)".
- **Fecha del gasto:** cuenta en **su** día, no en el día en que se registró.
  - **Retroactivos** (días pasados): permitidos, sin límite.
  - **Futuros:** **rechazados** en la API (400 `expense_date_future`; decisión del producto), igual que en la pantalla.
- **Anular** exige motivo. Nada se borra, y lo anulado deja de contar en todas partes.
- **Monto:** de $1 a $1.000.000.000, entero (`docs/finance-listings.md` y `expenseAmountIssue`).

## 6. Efectivo que sale de la caja

- Solo los gastos marcados **"pagado desde caja"** (siempre en efectivo) se restan del efectivo esperado. Pedirlo exige la
  caja de ese día abierta (409 `cash_not_open`).
- **Efectivo esperado = base del día + pagos en efectivo de las ventas − gastos pagados desde caja.**

## 7. Cierre de caja, ajustes y cambios posteriores

- El cierre **firma** el resumen del día y nunca cambia. Ver la concurrencia en `docs/cash-concurrency.md`.
- **Gasto desde caja de un día cerrado:**
  - Uno nuevo se rechaza (se puede registrar como "no pagado desde caja").
  - Editarlo o anularlo exige un **ajuste con motivo**, que queda registrado con el antes y el después.
- **Gastos no pagados desde caja** en un día cerrado: permitidos, porque no tocan el efectivo.
- **Ventas y anulaciones de ventas** en un día cerrado: permitidas. El resumen las muestra aparte: "Después del cierre:
  ventas +$X · efectivo esperado +$Y. El cierre firmado no cambia."

## 8. Zona horaria

- Ventas, registros de servicio y citas caen en el día local del negocio según su hora real. Una venta a las 11:30 p. m.
  hora Bogotá es de ese día, aunque en UTC ya sea el siguiente (`balance.test.ts`).
- Los gastos se guardan con su fecha local (sin hora). "Hoy" siempre es la fecha de la zona del negocio.
