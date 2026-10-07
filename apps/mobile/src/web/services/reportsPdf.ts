/**
 * Reporte en PDF (web). El documento lo arma `@/lib/exports/reportsPdf`, compartido con Android/iOS; aquí solo vive la
 * descarga del navegador.
 */
import { buildReportsPdf, reportsPdfFileName, type ReportsPdfInput } from '@/lib/exports/reportsPdf';

export * from '@/lib/exports/reportsPdf';

/** Genera el reporte y dispara la descarga del navegador. */
export function downloadReportsPdf(input: ReportsPdfInput): void {
  buildReportsPdf(input).save(reportsPdfFileName(input.periodLabel));
}
