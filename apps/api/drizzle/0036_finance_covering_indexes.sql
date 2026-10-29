-- Índices parciales "de cobertura" para el Balance general (Fase 6 de la auditoría; aprobados por el producto, 2026-10-14).
-- Medido en docs/finance-capacity.md con 2 años de un negocio grande (dentro de transacciones revertidas, mismo SQL y RLS):
-- totales de 12 meses 256 a 151 ms, gráfico 270 a 143 ms, conteo de movimientos 215 a 94 ms. Solo cubren lo que el balance
-- lee (monto y tipo; descuento y propina) de lo VIGENTE, así que PostgreSQL responde desde el índice sin leer la tabla.
-- Costo: espacio en disco y un poco más de trabajo al registrar ventas y cobros.
--
-- Drizzle no expresa INCLUDE: estos índices viven SOLO en esta migración (ver la nota en src/db/schema.ts).
-- PRODUCCIÓN: CREATE INDEX bloquea las escrituras de la tabla mientras se construye (segundos en tablas grandes). Aplicarla
-- en un horario de poco uso, o crear antes los índices a mano con CREATE INDEX CONCURRENTLY (mismos nombres; el
-- IF NOT EXISTS de aquí los deja tal cual).
-- Reversión: drizzle/rollback/0036_finance_covering_indexes.down.sql
CREATE INDEX IF NOT EXISTS "service_records_balance_idx" ON "service_records" USING btree ("business_id", "created_at") INCLUDE ("amount", "kind") WHERE "voided" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_balance_idx" ON "sales" USING btree ("business_id", "created_at") INCLUDE ("discount", "tip") WHERE "status" = 'completed';
