/**
 * Impresión aislada (solo web). `window.print()` sobre la app imprime su maquetación: contenedores de alto fijo con
 * desplazamiento interno, barra lateral, botones… y el navegador acababa entregando una hoja en blanco o recortada. Aquí se
 * imprime un documento PROPIO dentro de un iframe oculto: solo el comprobante, en una columna vertical tipo ticket (80 mm)
 * con su propio CSS @media print. La app no cambia de aspecto mientras tanto.
 */

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface TicketRow {
  label: string;
  value: string;
  /** Fila destacada (el total). */
  strong?: boolean;
}

export interface TicketLine {
  name: string;
  detail?: string;
  amount: string;
}

export interface TicketDocument {
  title: string;
  header: string[];
  /** Datos del comprobante (número, fecha, cliente…). */
  meta: TicketRow[];
  lines?: TicketLine[];
  totals: TicketRow[];
  footer?: string;
  /** Idioma del documento (lectores de pantalla y separación de palabras). */
  lang?: string;
}

const TICKET_CSS = `
@page { size: 80mm auto; margin: 4mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font: 12px/1.45 "Courier New", ui-monospace, monospace; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ticket { width: 72mm; max-width: 100%; margin: 0 auto; padding: 2mm 0; }
.head { text-align: center; margin-bottom: 3mm; }
.head p { margin: 0; }
.head p:first-child { font-size: 15px; font-weight: 700; }
.rule { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
.row { display: flex; justify-content: space-between; gap: 3mm; }
.row span:first-child { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.row span:last-child { flex: none; text-align: right; white-space: nowrap; }
.row.strong { font-size: 14px; font-weight: 700; }
/* Datos y totales: la etiqueta nunca se parte; el valor largo (una fecha, un nombre) pasa a otra línea. */
.row.kv span:first-child { flex: none; white-space: nowrap; }
.row.kv span:last-child { flex: 1 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.line { margin: 1mm 0; }
.line small { display: block; color: #333; }
.foot { margin-top: 4mm; text-align: center; font-style: italic; }
@media screen { body { padding: 16px; background: #f2f2f2; } .ticket { background: #fff; padding: 4mm; } }
`;

function rowHtml(row: TicketRow): string {
  return `<div class="row kv${row.strong ? ' strong' : ''}"><span>${escapeHtml(row.label)}</span><span>${escapeHtml(row.value)}</span></div>`;
}

export function ticketHtml(ticket: TicketDocument): string {
  const lines = (ticket.lines ?? [])
    .map((line) => `<div class="line"><div class="row"><span>${escapeHtml(line.name)}</span><span>${escapeHtml(line.amount)}</span></div>${line.detail ? `<small>${escapeHtml(line.detail)}</small>` : ''}</div>`)
    .join('');
  return `<!doctype html><html lang="${escapeHtml(ticket.lang ?? 'es')}"><head><meta charset="utf-8"><title>${escapeHtml(ticket.title)}</title><style>${TICKET_CSS}</style></head><body><main class="ticket">
<div class="head">${ticket.header.filter(Boolean).map((h) => `<p>${escapeHtml(h)}</p>`).join('')}</div>
<hr class="rule">${ticket.meta.map(rowHtml).join('')}
${lines ? `<hr class="rule">${lines}` : ''}
<hr class="rule">${ticket.totals.map(rowHtml).join('')}
${ticket.footer ? `<p class="foot">${escapeHtml(ticket.footer)}</p>` : ''}
</main></body></html>`;
}

/** Imprime `html` (un documento completo) desde un iframe oculto y lo retira al terminar. */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Fuera de la vista pero con tamaño real (un iframe de 0×0 imprime en blanco en algunos navegadores).
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '80mm', height: '120mm', border: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(frame);
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    setTimeout(() => frame.remove(), 500);
  };
  const win = frame.contentWindow;
  const doc = frame.contentDocument ?? win?.document;
  if (!win || !doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const run = () => {
    win.addEventListener('afterprint', remove);
    win.focus();
    win.print();
    // Respaldo: algunos navegadores no disparan afterprint en iframes.
    setTimeout(remove, 60_000);
  };
  // Espera a que el documento (y sus fuentes) esté listo antes de imprimir.
  if (doc.readyState === 'complete') setTimeout(run, 50);
  else win.addEventListener('load', () => setTimeout(run, 50), { once: true });
}

export function printTicket(ticket: TicketDocument): void {
  printHtml(ticketHtml(ticket));
}
