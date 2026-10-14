# Revisión de operación y recuperación (Fase 8 de la auditoría)

Fecha: 2026-10-14. Sin acceso a un entorno de despliegue: se revisaron la configuración, el código y la documentación de
despliegue, y se ensayó una restauración **local**. No se tocó ningún dato real ni se hizo ningún simulacro sobre producción.

## 1. Lista de verificación

| Punto | Estado | Evidencia |
|---|---|---|
| Presupuesto de conexiones de PostgreSQL | ✅ Documentado | `docs/database-pooling.md`: instancias × (`DB_POOL_MAX` + 3) < `max_connections`, con o sin PgBouncer. El candado de caja es de transacción y funciona con PgBouncer en modo transacción (nota nueva). |
| Redis compartido entre instancias | ✅ Exigido | La API no arranca en producción sin `REDIS_URL` (`config.ts`). Límites de abuso y caché pública van en Redis. |
| Balanceador, readiness/liveness, escalado | ✅ Implementado | `/api/health` (liveness, sin base) y `/api/health/ready` (base y Redis). Imagen sin estado, escalable horizontalmente. `HEALTHCHECK` en el Dockerfile. |
| Cierre ordenado | ✅ Implementado | `SIGTERM` → deja de aceptar, termina lo en curso y cierra base, cola, Redis y los **hilos de descarga** (nuevo, `onClose`). Tope de 25 s: una descarga más larga se corta (el cliente reintenta). |
| Almacenamiento compartido de imágenes | ✅ Exigido | Producción exige `MEDIA_STORAGE=s3` (R2). |
| Alertas, registros y errores | ✅ API / ⏳ app | Logs JSON con `requestId` y redacción de secretos; Sentry en la API; métricas Prometheus con alertas sugeridas (`docs/deploy.md` §6). **Nuevas métricas**: `xiro_export_running` y `xiro_export_waiting`. Pendiente (ya planeado): Sentry en la app y el panel. |
| Respaldos | ✅ Tres capas | Del proveedor (PITR), copia cifrada diaria fuera del proveedor y simulacro en cada CI (`docs/deploy.md` §5). |
| Restauración y tiempo real de recuperación | ✅ Ensayado localmente | Respaldo de desarrollo restaurado en una base nueva y aparte en **8 s**: 55 tablas y 9.161 filas sin diferencias, con RLS, políticas y permisos idénticos. Falta medirlo con el volumen real de producción (trimestral). |
| Migraciones y reversión | ✅ | Paso aparte del despliegue, con candado. Reversión manual por migración desde 0024, probada en cadena (`indexes.test.ts`, `financeMigration.test.ts`). **Nuevas salvaguardas** en `test/migrationFiles.test.ts`: cada migración desde 0024 tiene su reversión y solo usa caracteres de Windows-1252. **0036** bloquea escrituras mientras crea los índices (`docs/deploy.md` §4). |
| Secretos | ✅ | Solo en el gestor de secretos del proveedor; `.dockerignore` excluye todos los `.env`; `scripts/check-env.ts` valida sin mostrar valores. La API se niega a arrancar con secretos débiles o modos inseguros (`JWT_SECRET` < 32, OTP de desarrollo, `RATE_LIMIT=off`, notificador de consola). |
| Dependencias vulnerables | ⚠️ 1 aviso moderado, aceptado | Producción de la API: solo `uuid` < 11.1.1 dentro de `exceljs` (falla en `v3`/`v5`/`v6` cuando se les pasa un búfer). exceljs solo usa `uuid.v4()`, en formato condicional que estas descargas no usan: **no es alcanzable**. El arreglo que propone npm es bajar a exceljs 3.4.0 (más vieja, con cambios incompatibles): descartado. Revisar cuando salga exceljs 4.4.1+. |

## 2. Hallazgos corregidos en esta fase

1. **Memoria del Excel (grave):** el Excel se armaba completo en memoria. El peor caso permitido (50.000 filas) pedía
   ~450 MB, y con el heap del contenedor documentado (384 MB) **tumbaba la API**. Ahora se escribe **por flujo** (~35 MB,
   la mitad del tiempo). Probado con un hilo de 128 MB.
2. **Presupuesto de memoria de los hilos de descarga** (los agregó la Fase 6): cada hilo tiene su propio heap.
   - Tope por hilo: `EXPORT_WORKER_MEMORY_MB` (256).
   - Guía de tamaños por contenedor en `docs/deploy.md` §3.
   - Ejemplos de 512 MB ajustados: heap de 320 MB y 1 hilo.
3. **Medición corregida:** el bloqueo de más de 1 s que reportó la Fase 6 incluía la carga inicial de módulos.
   - La cifra real por descarga es ~600 ms para el PDF; con hilos, 25 ms.
   - `docs/finance-capacity.md` queda actualizado con las cifras honestas.
4. **Migración con un carácter no representable:** un "→" en un comentario de 0036 hizo fallar la migración en la base de
   pruebas, y la API de desarrollo no arrancó durante unos minutos. Se corrigió y se agregó la salvaguarda.

## 3. Pendiente (requiere el entorno de despliegue o una decisión)

- Medir la restauración con el volumen de producción y anotar el tiempo real de recuperación.
- Confirmar en el proveedor: retención de respaldos (≥ 7 días, 30 recomendados), PITR activo, reglas de ciclo de vida
  en R2 y que `BACKUP_PASSPHRASE` esté guardada fuera de GitHub.
- Configurar las alertas sugeridas en el recolector de métricas, incluida `xiro_export_waiting`.
- Fijar la imagen base por digest antes de la salida a producción.
- Elegir un proveedor de notificaciones (OTP): sin él la API no arranca en producción (bloqueante conocido).
- Fase 7 (5.000 usuarios simultáneos): cuando exista el staging en la nube.
