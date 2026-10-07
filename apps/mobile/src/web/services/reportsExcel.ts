/**
 * Reporte en Excel (web). El libro lo arma `@/lib/exports/reportsExcel`, compartido con Android/iOS; aquí solo vive la
 * descarga del navegador.
 */
import { buildReportsWorkbook, reportsExcelFileName, type ReportsExcelInput } from '@/lib/exports/reportsExcel';

export * from '@/lib/exports/reportsExcel';

/** Genera el libro y dispara la descarga del navegador (sin pasar por el servidor). */
export async function downloadReportsExcel(input: ReportsExcelInput): Promise<void> {
  const workbook = buildReportsWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = reportsExcelFileName(input.periodLabel);
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
