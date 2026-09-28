/** Descarga un archivo de texto generado en el navegador (nada sale del dispositivo). */
export function downloadTextFile(fileName: string, content: string, mime = 'text/calendar;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Nombre de archivo seguro: minúsculas, sin tildes ni espacios ("Xiro Beauty Studio" → "xiro-beauty-studio"). */
export function safeFileName(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'cita'
  );
}
