import { translate, type Language } from '@xiro/shared';
import { assistantEn, assistantEs } from '../strings/assistant';
import { authEn, authEs } from '../strings/auth';
import { homeEn, homeEs } from '../strings/home';
import { legalEn, legalEs } from '../strings/legal';
import { profileEn, profileEs } from '../strings/profile';
import { welcomeEn, welcomeEs } from '../strings/welcome';

/** Textos exclusivos de la web (el diccionario compartido con nativo no se toca). */
const es = {
  skip_to_content: 'Saltar al contenido',
  main_nav: 'Navegación principal',
  breadcrumb: 'Ruta de navegación',
  open_menu: 'Abrir menú',
  close_menu: 'Cerrar menú',
  collapse_sidebar: 'Contraer barra lateral',
  expand_sidebar: 'Expandir barra lateral',
  nav_home: 'Inicio',
  nav_agenda: 'Citas',
  nav_clients: 'Clientes',
  nav_services: 'Servicios',
  nav_inventory: 'Inventario',
  nav_employees: 'Empleados',
  nav_reports: 'Reportes',
  nav_loyalty: 'Fidelización',
  nav_settings: 'Ajustes',
  soon: 'Próximamente',
  crumb_detail: 'Ficha',
  crumb_send: 'Enviar',
  crumb_cash: 'Base de caja',
  page_title_suffix: 'Xiro Style',
  show_password: 'Mostrar contraseña',
  hide_password: 'Ocultar contraseña',
  close_notice: 'Cerrar aviso',
  ...welcomeEs,
  ...authEs,
  ...homeEs,
  ...assistantEs,
  ...legalEs,
  ...profileEs,
} as const;

export type WebStringKey = keyof typeof es;

const en: Record<WebStringKey, string> = {
  skip_to_content: 'Skip to content',
  main_nav: 'Main navigation',
  breadcrumb: 'Breadcrumb',
  open_menu: 'Open menu',
  close_menu: 'Close menu',
  collapse_sidebar: 'Collapse sidebar',
  expand_sidebar: 'Expand sidebar',
  nav_home: 'Home',
  nav_agenda: 'Appointments',
  nav_clients: 'Clients',
  nav_services: 'Services',
  nav_inventory: 'Inventory',
  nav_employees: 'Employees',
  nav_reports: 'Reports',
  nav_loyalty: 'Loyalty',
  nav_settings: 'Settings',
  soon: 'Coming soon',
  crumb_detail: 'Details',
  crumb_send: 'Send',
  crumb_cash: 'Cash float',
  page_title_suffix: 'Xiro Style',
  show_password: 'Show password',
  hide_password: 'Hide password',
  close_notice: 'Dismiss notice',
  ...welcomeEn,
  ...authEn,
  ...homeEn,
  ...assistantEn,
  ...legalEn,
  ...profileEn,
};

const dictionaries: Record<Language, Record<WebStringKey, string>> = { es, en };

/** Traduce claves web; si no existe, recurre al diccionario compartido. Soporta los mismos `{parámetros}` que `translate`. */
export function tw(language: Language, key: string, params?: Record<string, string | number>): string {
  const own = (dictionaries[language] as Record<string, string>)[key];
  if (own === undefined) return translate(language, key, params);
  if (!params) return own;
  let text = own;
  for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
