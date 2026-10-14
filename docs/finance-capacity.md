# Capacidad medida de los reportes financieros (Fase 6 de la auditoría)

Fecha: 2026-10-14. Script: `apps/api/loadtest/finance.measure.ts`. Ejecútalo desde `apps/api` con
`npx vitest run --config loadtest/vitest.measure.config.ts`. Resultados completos en `apps/api/data/medicion/` (fuera de Git).

## 1. Cómo se midió

| | |
|---|---|
| Máquina | La misma portátil de `docs/capacity.md` (6 núcleos, 7,5 GB de RAM). **API, PostgreSQL, Expo, Vite y el navegador comparten la máquina**: los tiempos de punta a punta varían entre corridas (p. ej. el balance de 12 meses dio 650 ms en una y 1.100 ms en otra). Los `EXPLAIN` son más estables y son la base de las decisiones. |
| Base | PostgreSQL **efímero** de las pruebas (binarios oficiales, configuración por defecto: `shared_buffers` pequeño). **Nunca** desarrollo ni producción. Tras sembrar: `VACUUM ANALYZE` (estado estable, como tras el autovacuum). |
| Datos | 21 negocios y 587 MB. Un negocio **grande** con 2 años: 182.500 ventas (2 % anuladas, 10 % con descuento, 14 % con propina), 265.233 registros de lo cobrado (incluye 30 cobros sin venta al día) y 10.950 gastos. Otros 20 negocios con 1 año de datos propios. En total: 474.500 ventas, 691.053 registros, 632.653 líneas de venta y 32.850 gastos. |
| SQL | El **real** de la API, capturado al vuelo, con `EXPLAIN (ANALYZE, BUFFERS)` bajo el mismo rol y RLS de cada ruta. |
| Tiempos | p50/p95 de 5 llamadas (más 1 de calentamiento) y el **bloqueo máximo del hilo de Node** (`monitorEventLoopDelay`) mientras se atiende. |
| Ráfaga | 20 peticiones a la vez del negocio grande: 4 Excel del balance (30 días), 4 PDF (12 meses), 8 balances (12 meses) y 4 Excel de gastos (12 meses). Pool de 10 conexiones. |

## 2. Hallazgos

1. **Totales del balance:** recorrían cada tabla **dos veces** (una por cada suma). En 12 meses o más, PostgreSQL elige un
   recorrido completo de la tabla (`Seq Scan`) por la cantidad de filas, y eso se pagaba doble.
2. **Movimientos:** la página y el conteo recorren la misma unión (unas 135.000 filas en 12 meses). Una página profunda
   (OFFSET alto) cuesta **lo mismo** que la primera: el OFFSET no es el problema, sí lo es ordenar la unión completa.
3. **Descargas (el más grave):** generar el PDF o el Excel es trabajo de CPU síncrono y **bloquea el hilo de Node**, el
   mismo que atiende a todos los demás usuarios de la instancia.
   > **Corrección (Fase 8):** la primera medición daba 1,24 s para un Excel y 1,03 s para un PDF, pero incluía la llamada
   > de calentamiento (carga de módulos y de las fuentes del PDF, que ocurre una sola vez por proceso). Medido sin el
   > calentamiento: el **PDF bloquea ~600 ms en CADA descarga** (601 ms con 30 días, 634 ms con 12 meses). El Excel
   > bloqueaba ~250–300 ms ya con la escritura por flujo (punto 6).
6. **Memoria del Excel (Fase 8):** el Excel se armaba completo en memoria. El peor caso permitido (50.000 filas) pedía
   **~450 MB** de heap y 6,4 s. Con el heap del contenedor documentado (384 MB) eso **tumba la API**: en una prueba con un
   tope de 384 MB, el proceso entero terminó por falta de memoria.
4. **El Excel sobre el tope** (más de 50.000 movimientos) tardaba 1,6 s en responder el 400, porque cargaba las filas antes
   de contar.
5. **Sin bloqueos:** en ninguna corrida hubo esperas por bloqueos en PostgreSQL (`pgLockWaitsMax` = 0). En la ráfaga el
   pool se llena (10 en uso y hasta 10 esperando): las consultas largas del balance retienen la conexión cerca de 1 s.

## 3. Cambios aplicados (mismas reglas y mismas cifras; pruebas de conciliación en verde)

| Cambio | Antes | Después |
|---|---|---|
| Totales del balance: **una pasada por tabla** (`booking/balance.ts`) | consulta de totales de 12 meses: 983 ms; balance 12 meses p50 1.288 ms | 302 ms; p50 650 ms (en otra corrida, 1.100 ms con la máquina más cargada) |
| Excel sobre el tope: **contar primero** y rechazar sin cargar | 1.636 ms para responder 400 | 211 ms |
| Descargas en **hilos de trabajo** con cola acotada (`exports/pool.ts`; `EXPORT_WORKERS` = 2, `EXPORT_QUEUE_MAX` = 20, `EXPORT_TIMEOUT_MS` = 60.000, `EXPORT_WORKER_MEMORY_MB` = 256) | hilo principal bloqueado (sin el calentamiento): PDF 30 días 601 ms, PDF 12 meses 634 ms, Excel 30 días 244 ms, Excel de gastos 303 ms | 24 ms, 25 ms, 55 ms, 110 ms. Con la cola llena: 503 `server_busy` con `Retry-After` (nunca se acumulan archivos sin límite) |
| **Excel escrito por flujo** (`WorkbookWriter` de exceljs; Fase 8) | 50.000 filas: ~450 MB de heap, 6,4 s | ~35 MB, 3,5 s (cabe en un hilo de 128 MB; probado en `exportPool.test.ts`) |

Ráfaga de 20 peticiones, con el Excel ya por flujo: 9,4 s sin hilos y 8,7 s con 2 hilos. Memoria residente máxima: 480 MB
sin hilos y 739 MB con 2 (unos 130 MB por hilo). Los hilos se justifican sobre todo por el **PDF**. Con poca RAM,
`EXPORT_WORKERS=1`; con `0` se genera en el hilo principal (el Excel por flujo cede el turno cada 2.000 filas, pero el PDF
sigue bloqueando ~600 ms).

**Descartado por la medición:** calcular el total de movimientos en la misma consulta de la página (`count(*) over ()`).
Salió **peor** (494 ms frente a 426 ms), porque obliga a ordenar todas las filas y no solo las 50 de la página.

## 4. Propuesta pendiente de aprobación: dos índices parciales

Probados dentro de transacciones que se revierten (no tocan el esquema), con el mismo SQL, rol y RLS:

| Consulta (negocio grande) | Sin índices | Con índices |
|---|---|---|
| Totales del balance, 12 meses | 256 ms | 151 ms |
| Serie del gráfico, 12 meses | 270 ms | 143 ms |
| Totales, 3 años | 286 ms | 172 ms |
| Conteo de movimientos, 12 meses | 215 ms | 94 ms |
| Página de movimientos | 205 ms | 217 ms (sin cambio) |

- `service_records (business_id, created_at) INCLUDE (amount, kind) WHERE voided = false`
- `sales (business_id, created_at) INCLUDE (discount, tip) WHERE status = 'completed'`

**Beneficio:** −40 % a −56 % en totales, gráfico y conteo de rangos largos. **Costo:** espacio en disco y un poco más de
trabajo en cada venta y cada cobro registrado. Solo vale la pena con negocios de mucho volumen y reportes de muchos meses.
Requiere una migración (reversible), así que queda **pendiente de aprobación**.

## 5. Pool y conexiones

- Presupuesto: **instancias × `DB_POOL_MAX` + conexiones de la cola de trabajos y de migraciones ≤ `max_connections` de
  PostgreSQL**, dejando margen para administración. No se aumentó el pool: en la ráfaga la espera viene de consultas
  largas, y más conexiones solo moverían la cola a PostgreSQL. Ver `docs/database-pooling.md`.
- Las rutas financieras abren una sola transacción por petición. El candado de caja (`docs/cash-concurrency.md`) no
  apareció como espera en ninguna medición.

## 6. Límites de esta medición

- Una sola máquina compartida. No es producción: falta Redis, el balanceador y TLS. **No sirve para afirmar capacidad de
  usuarios simultáneos**; eso corresponde a la Fase 7, en un staging aislado y con umbrales acordados.
- PostgreSQL con configuración por defecto. Con más `shared_buffers` y `work_mem`, los recorridos y ordenamientos grandes
  bajarían.
