# Listados y descargas completos (Finanzas)

Fecha: 2026-10-13. Pruebas: `apps/api/test/expensesPaging.test.ts`.

## 1. El problema

- `GET /expenses` devolvía como máximo 1.000 filas sin avisar. La pantalla de Gastos sumaba lo que recibía, así que con
  más filas la lista quedaba incompleta **y el "Total del periodo" salía mal**, sin que se notara.
- La descarga en Excel de Gastos cortaba en 5.000 filas sin avisar.
- El PDF y el Excel del balance cortaban en 5.000 movimientos. Lo decían dentro del archivo, pero el Excel no traía todo.

## 2. Comportamiento nuevo (decisión del producto)

### Listado de Gastos: `GET /expenses/page` (nuevo)

- Mismos filtros que `GET /expenses` (`from`, `to`, `type`, `category`, `employeeId`, `status`) más `limit` (1–100, por
  defecto 50) y `cursor`. Permiso: dueño o "Finanzas", igual que el resto de Gastos.
- Respuesta: `{ data: ExpenseDto[], nextCursor: string | null, summary: { count, activeCount, activeTotal } | null }`.
- **Orden estable:** fecha del gasto, momento del alta e id, de lo más reciente a lo más antiguo. El cursor es la clave de
  la última fila (las fechas viajan con microsegundos), así que ninguna fila se repite ni se salta aunque se registren
  gastos mientras se navega.
- `summary` se calcula en el servidor sobre **todo** el rango y los filtros, y solo viene en la primera página (no cambia
  al pasar de página). La pantalla muestra ese total y esa cantidad, nunca la suma de lo cargado.
- La pantalla de Gastos (web y Android/iOS) carga de 50 en 50 con "Cargar más" y muestra "Mostrando X de Y".

`GET /expenses` **se conserva sin cambios** (hasta 1.000 filas) para las versiones de la app ya instaladas.

### Descargas

- **Excel de Gastos** (`GET /expenses/export.xlsx`) y **Excel del balance** (`GET /reports/balance/export.xlsx`) traen
  **todas** las filas del rango, hasta `EXPORT_MAX_ROWS` = 50.000. Si un rango pasa de ese tope, la respuesta es
  `400 { code: 'export_too_many_rows', count, max }` y la pantalla pide un periodo más corto. **Nunca se entrega un
  archivo cortado en silencio.**
- **PDF del balance** (`GET /reports/balance/export.pdf`): los totales, la gráfica y las tablas por periodo y por
  categoría son siempre del periodo **completo**. La lista de movimientos incluye los primeros 2.000 (`PDF_MAX_MOVEMENTS`).
  Si hay más, el archivo lo dice ("…el Excel los trae todos"), la fila de total se llama "Total de lo incluido" y la
  pantalla avisa antes de descargar.

El límite de 12 meses por descarga sigue igual.

## 3. Pruebas

- Menos filas que el límite (30), exactamente el límite (50) y muchas más (1.234): recorrido completo sin repetidos ni
  omitidos, en orden, con todas las filas sembradas con el mismo instante de alta para forzar el desempate por id.
- Altas en medio de la navegación: ninguna fila que ya existía se repite ni se pierde.
- Filtros iguales para filas y totales; cursor alterado → 400; otro negocio no ve nada (ni con un cursor ajeno); empleado
  sin "Finanzas" → 403.
- Excel de 6.000 gastos: trae las 6.000 y el total coincide. Con 56.000: 400 `export_too_many_rows` en gastos y en el
  balance.
- Balance con 5.500 movimientos: el Excel los trae todos; el PDF incluye 2.000, lo dice, y sus totales son del periodo
  completo.
