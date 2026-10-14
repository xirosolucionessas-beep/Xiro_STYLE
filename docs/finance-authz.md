# Autorización y aislamiento de lo financiero (auditoría)

Fecha: 2026-10-13. Pruebas: `apps/api/test/financeIsolation.test.ts` y el barrido general `apps/api/test/tenantIsolation.test.ts`.

## 1. Cómo se decide quién entra (en cada petición)

- **Sesión:** `authenticate` (`src/app.ts`) verifica el token y lo contrasta con la base. El usuario debe existir y estar
  **activo**; el negocio del token (`bid`) debe ser el del usuario; y un cambio de contraseña invalida los tokens anteriores.
- **Rol y permisos:** se leen **de la base en cada petición**, nunca del token. Quitar "Finanzas" o desactivar a un
  empleado aplica en la siguiente petición, sin esperar a que el token venza (probado).
- **Política:** `POLICY` (`src/authz.ts`) es por defecto-denegar. Una ruta sin entrada no arranca (`assertPolicyCovers`) y,
  si se llega a evaluar, se trata como "solo dueño".
- **Negocio:** en las 24 rutas financieras sale **siempre** de la sesión (`request.user.bid`). Ninguna lo lee de la URL, el
  cuerpo o la consulta.

## 2. Endpoints

| Endpoint | Quién | Acceso a la base | Filtro por negocio |
|---|---|---|---|
| `GET /expenses`, `/expenses/page`, `/expenses/:id`, `/expenses/payees`, `/expenses/export.xlsx` | Dueño o "Finanzas" | `withBusiness` (rol restringido + RLS) | Sí, en todas las consultas (`filtersOf`, búsqueda por id + negocio) |
| `POST /expenses`, `PUT /expenses/:id`, `POST /expenses/:id/void` | Dueño o "Finanzas" | `withBusiness` (RLS) | Sí. El beneficiario de nómina se valida contra el negocio (`expense_employee_invalid`) |
| `GET /reports/balance`, `/movements`, `/export.pdf`, `/export.xlsx` | Dueño o "Finanzas" | `withBusiness` (RLS, desde 0035) | Sí: cada subconsulta SQL lleva `business_id = <sesión>`, y además el RLS |
| `GET /cash/close-summary`, `/cash/closings`, `/cash/closings/:id`, `/cash/openings`, `/cash/today` | Solo dueño | Conexión directa | Sí, en todas las consultas |
| `POST /cash/opening`, `/cash/close`, `/cash/closings/:id/void` | Solo dueño | Directa / `withBusinessTrusted` | Sí |
| `GET /sales`, `/sales/:id`, `POST /sales` | "Registrar servicios" | Directa / `withBusinessTrusted` | Sí |
| `POST /sales/:id/void` | Solo dueño | `withBusinessTrusted` | Sí |

**Balance con dos barreras (migración 0035, aprobada):** `service_records` (lo cobrado) tiene RLS por negocio y el rol restringido
`xiro_app` puede leerla (solo leer). El balance corre con `withBusiness`: aunque una consulta olvidara filtrar por negocio, la
base no devolvería filas de otro (probado: con el rol restringido, una consulta sin filtro solo ve lo propio, y ese rol no puede
modificar la tabla). Caja y Ventas siguen como estaban (`withBusinessTrusted` o conexión directa) y su protección es el filtro
de cada consulta.

## 3. Hallazgos

1. **Ventas — búsqueda de nombres sin filtro por negocio (reforzado).** `loadSaleDtos` buscaba los nombres de usuarios y
   clientes solo por id, con la conexión sin RLS. **No era explotable:** esos ids salen de filas de ventas del propio
   negocio, y sus claves foráneas son compuestas (id + negocio), así que no pueden apuntar a otro negocio. Se agregó el
   filtro por negocio como defensa en profundidad. El resultado es idéntico.
2. Ninguna otra consulta financiera carece de filtro por negocio. Un id de otro negocio responde **exactamente** igual que
   un id inexistente (mismo 404 y mismo cuerpo), así que no se puede saber si existe.

**Segunda barrera aplicada (2026-10-13):** migración `0035_service_records_rls` (reversión en
`drizzle/rollback/0035_service_records_rls.down.sql`; respaldo previo de la base de desarrollo en
`data/backups/respaldo-antes-0035.dump`).

## 4. Pruebas (`financeIsolation.test.ts`)

- **Lecturas del negocio B:** gastos, página, beneficiarios, balance, movimientos, resumen, cierres y aperturas de caja,
  caja de hoy y ventas. Ninguna respuesta contiene textos, montos, ids ni nombres del personal de A. Control positivo: A sí
  los ve. Los Excel de B tampoco tienen ninguna celda de A.
- **Inferencia:** los ids de A (gasto, cierre, venta) responden igual que un id inexistente.
- **Escrituras de B con ids de A:** editar o anular un gasto, anular una venta o un cierre → 404, y en la base lo de A
  queda intacto. Pagar nómina a un empleado de A → 400 y no se crea nada.
- **Permisos:**
  - Con "Finanzas": gastos, balance y descargas sí; caja y anular ventas (solo dueño) → 403.
  - Sin "Finanzas": 403 en todo lo anterior, también al escribir.
  - Quitar el permiso aplica en la siguiente petición; volver a darlo, también. Desactivar al empleado → 401.
