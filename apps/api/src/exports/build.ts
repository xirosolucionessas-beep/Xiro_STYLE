import type { ExpenseDto, Language } from '@xiro/shared';
import { buildBalancePdf, buildBalanceXlsx, buildExpensesXlsx, type BalanceExportData, type ExportBusiness } from '../booking/balanceExport';

/**
 * Un archivo a generar (lo que viaja al hilo de trabajo). Solo datos planos ya consultados: el hilo NO toca la base, solo
 * arma el PDF o el Excel, así que el aislamiento por negocio se decide antes (en la ruta, con la sesión).
 */
export type ExportJob =
  | { kind: 'balance-pdf'; data: BalanceExportData; lang: Language }
  | { kind: 'balance-xlsx'; data: BalanceExportData; lang: Language }
  | { kind: 'expenses-xlsx'; rows: ExpenseDto[]; business: ExportBusiness; range: { from: string; to: string }; lang: Language };

/** Genera el archivo (en el hilo de trabajo, o en el principal si EXPORT_WORKERS=0). */
export function buildExport(job: ExportJob): Promise<Buffer> {
  switch (job.kind) {
    case 'balance-pdf':
      return buildBalancePdf(job.data, job.lang);
    case 'balance-xlsx':
      return buildBalanceXlsx(job.data, job.lang);
    case 'expenses-xlsx':
      return buildExpensesXlsx(job.rows, job.business, job.range, job.lang);
  }
}
