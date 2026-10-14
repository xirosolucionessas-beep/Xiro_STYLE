import { EXPORT_MAX_ROWS, balanceExportQuerySchema, balanceMovementsQuerySchema, balanceQuerySchema, type BalanceDto, type BalanceMovementsPage, type Currency } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { balanceMovements, balanceMovementsCount, computeBalance } from '../booking/balance';
import { exportFileName, loadBalanceExport, PDF_MAX_MOVEMENTS, type ExportBusiness } from '../booking/balanceExport';
import { withBusiness, type Tx } from '../booking/scope';
import { localDate } from '../booking/time';
import type { Ctx } from '../context';
import { businesses } from '../db/schema';
import { AppError, notFound, parse } from '../errors';

/**
 * Balance general (Reportes → Balance general). Solo el dueño o un empleado con "Finanzas" (authz.ts: 403 a cualquier otro).
 * Dos barreras de aislamiento: el negocio sale SIEMPRE de la sesión y TODAS las consultas filtran por él, y además corre con
 * `withBusiness` (rol restringido + RLS: aunque una consulta olvidara el filtro, la base no devuelve filas de otro negocio;
 * `service_records` tiene RLS desde la migración 0035). El rango llega en días locales y no puede terminar en el futuro. Las mismas cuentas sirven a la pantalla, a los gráficos y (fase 6) a las descargas.
 */
export function balanceRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  async function timezoneOf(tx: Tx, businessId: string): Promise<string> {
    const [row] = await tx.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!row) throw notFound();
    return row.timezone;
  }

  /** Zona del negocio, y el rango no puede pasar de hoy (en esa zona). */
  async function prepare(tx: Tx, businessId: string, to: string): Promise<string> {
    const timezone = await timezoneOf(tx, businessId);
    if (to > localDate(new Date(), timezone)) throw new AppError(400, 'range_future');
    return timezone;
  }

  app.get('/reports/balance', async (request): Promise<BalanceDto> => {
    const { from, to } = parse(balanceQuerySchema, request.query);
    const businessId = request.user.bid;
    return withBusiness(db, businessId, async (tx) => computeBalance(tx, businessId, from, to, await prepare(tx, businessId, to)));
  });

  app.get('/reports/balance/movements', async (request): Promise<BalanceMovementsPage> => {
    const query = parse(balanceMovementsQuerySchema, request.query);
    const businessId = request.user.bid;
    return withBusiness(db, businessId, async (tx) => balanceMovements(tx, businessId, query, await prepare(tx, businessId, query.to)));
  });

  /** Datos del negocio para el encabezado del archivo (solo lo necesario, del negocio de la sesión). */
  async function exportBusiness(tx: Tx, businessId: string): Promise<ExportBusiness & { slug: string }> {
    const [row] = await tx
      .select({ name: businesses.name, slug: businesses.slug, address: businesses.address, city: businesses.city, currency: businesses.currency, timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    if (!row) throw notFound();
    return { ...row, currency: row.currency as Currency };
  }

  /**
   * Descargas del balance (PDF y Excel), generadas aquí con las MISMAS cuentas que la pantalla. Como máximo 12 meses
   * (`export_range_too_long`) y nunca en el futuro. `Cache-Control: no-store`: son datos financieros privados.
   */
  for (const format of ['pdf', 'xlsx'] as const) {
    app.get(`/reports/balance/export.${format}`, async (request, reply) => {
      const { from, to, lang } = parse(balanceExportQuerySchema, request.query);
      const businessId = request.user.bid;
      const { data, slug } = await withBusiness(db, businessId, async (tx) => {
        const business = await exportBusiness(tx, businessId);
        if (to > localDate(new Date(), business.timezone)) throw new AppError(400, 'range_future');
        // Excel: todos los movimientos (o 400 si son demasiados). PDF: los primeros PDF_MAX_MOVEMENTS, avisado en el archivo.
        // Excel sobre el tope: se cuenta primero y se rechaza SIN cargar las filas (medido: antes tardaba ~1,6 s en decir que no).
        if (format === 'xlsx') {
          const count = await balanceMovementsCount(tx, businessId, { from, to, kind: 'all' }, business.timezone);
          if (count > EXPORT_MAX_ROWS) throw new AppError(400, 'export_too_many_rows', undefined, undefined, { count, max: EXPORT_MAX_ROWS });
        }
        const data = await loadBalanceExport(tx, businessId, business, from, to, format === 'pdf' ? PDF_MAX_MOVEMENTS : EXPORT_MAX_ROWS);
        return { data, slug: business.slug };
      });
      // El archivo se arma en un hilo de trabajo (exports/pool.ts): no bloquea a las demás peticiones de la instancia.
      const file = await ctx.exports.run({ kind: format === 'pdf' ? 'balance-pdf' : 'balance-xlsx', data, lang });
      return reply
        .header('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${exportFileName('balance', slug, from, to, format)}"`)
        .header('Cache-Control', 'no-store')
        .send(file);
    });
  }
}
