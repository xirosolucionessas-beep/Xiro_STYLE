/** Metadatos de cada ruta de la app: título, migas de pan, sección activa y ancho de contenido. Puro (sin React). */
import type { IconName } from '../icons';

export type SectionId = 'home' | 'notifications' | 'messages' | 'agenda' | 'orders' | 'expenses' | 'booking' | 'reports' | 'clients' | 'services' | 'inventory' | 'loyalty' | 'employees' | 'settings';

export interface Crumb {
  /** Clave de traducción. */
  labelKey: string;
  href?: string;
}

export interface RouteInfo {
  /** Clave de traducción del título de la página (también para document.title). */
  titleKey: string;
  section: SectionId | null;
  /** Ícono del encabezado de la pantalla; sin esto, usa el de `section` (p. ej. una ficha de cliente hereda el de Clientes).
   * Se fija aquí cuando la pantalla NO corresponde de verdad a su sección (p. ej. Ventas de hoy cuelga de "Inicio" para
   * la barra lateral, pero su encabezado no debe mostrar la casa). */
  icon?: IconName;
  trail: Crumb[];
  /** Pantallas de autenticación: sin sidebar, contenido estrecho. */
  auth: boolean;
  /** 'form' limita el contenido a un ancho cómodo de lectura; 'wide' usa el máximo (1200px). */
  width: 'wide' | 'form';
  /** La pantalla no trae su propio <h1>; el shell aporta uno (oculto visualmente). */
  needsHeading: boolean;
  /** La pantalla ya muestra su propio error con botón de reintento: el shell no añade el aviso global. */
  inlineErrors?: boolean;
  /** Pantalla a sangre (sin ancho máximo): la bienvenida usa toda la ventana en dos mitades. */
  bleed?: boolean;
  /** Oculta el WhatsApp/asistente flotantes: flujos enfocados (checkout) donde no deben tapar ni distraer del CTA. */
  hideFloating?: boolean;
  /** Pantalla a pantalla completa aun con sesión iniciada: sin sidebar ni barra de migas (p. ej. elegir plan tras registrarse). */
  standalone?: boolean;
}

const HOME: Crumb = { labelKey: 'nav_home', href: '/' };
const INVENTORY: Crumb = { labelKey: 'nav_inventory', href: '/inventory' };
const SERVICES: Crumb = { labelKey: 'nav_catalog', href: '/catalog' };
const CLIENTS: Crumb = { labelKey: 'nav_clients', href: '/clients' };
const SETTINGS: Crumb = { labelKey: 'nav_settings', href: '/more' };
const LOYALTY: Crumb = { labelKey: 'nav_loyalty', href: '/loyalty' };

const AUTH = (titleKey: string, extra: Partial<RouteInfo> = {}): RouteInfo => ({ titleKey, section: null, trail: [{ labelKey: titleKey }], auth: true, width: 'form', needsHeading: false, ...extra });

export function describeRoute(pathname: string, search = ''): RouteInfo {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const editing = new URLSearchParams(search).has('id');
  // Panel del fundador: pantalla completa, sin la barra lateral ni las herramientas de un negocio.
  if (path === '/platform' || path.startsWith('/platform/')) {
    return { titleKey: 'platform_title', section: null, trail: [{ labelKey: 'platform_title' }], auth: false, width: 'wide', needsHeading: false, hideFloating: true, standalone: true };
  }

  switch (path) {
    case '/':
      return { titleKey: 'nav_home', section: 'home', trail: [{ labelKey: 'nav_home' }], auth: false, width: 'wide', needsHeading: true };
    case '/notifications':
      return { titleKey: 'notifications', section: 'notifications', trail: [HOME, { labelKey: 'notifications' }], auth: false, width: 'wide', needsHeading: false };
    case '/messages':
      return { titleKey: 'messages_title', section: 'messages', trail: [HOME, { labelKey: 'messages_title' }], auth: false, width: 'wide', needsHeading: false };
    case '/orders':
      return { titleKey: 'nav_orders', section: 'orders', trail: [HOME, { labelKey: 'nav_orders' }], auth: false, width: 'wide', needsHeading: false };
    case '/expenses':
      return { titleKey: 'nav_expenses', section: 'expenses', trail: [HOME, { labelKey: 'nav_expenses' }], auth: false, width: 'wide', needsHeading: false };
    case '/agenda':
      return { titleKey: 'nav_agenda', section: 'agenda', trail: [HOME, { labelKey: 'nav_agenda' }], auth: false, width: 'wide', needsHeading: false };
    case '/booking':
      return { titleKey: 'booking_title', section: 'booking', trail: [HOME, { labelKey: 'booking_title' }], auth: false, width: 'wide', needsHeading: false };
    case '/packages':
      return { titleKey: 'pkg_title', section: 'services', trail: [HOME, SERVICES, { labelKey: 'pkg_title' }], auth: false, width: 'wide', needsHeading: false };
    case '/review-items':
      return { titleKey: 'review_title', section: 'services', trail: [HOME, SERVICES, { labelKey: 'review_title' }], auth: false, width: 'form', needsHeading: false };
    case '/reports/balance':
      return { titleKey: 'rep_tab_balance', section: 'reports', trail: [HOME, { labelKey: 'nav_reports', href: '/reports' }, { labelKey: 'rep_tab_balance' }], auth: false, width: 'wide', needsHeading: false };
    case '/reports':
      return { titleKey: 'nav_reports', section: 'reports', trail: [HOME, { labelKey: 'nav_reports' }], auth: false, width: 'wide', needsHeading: false };
    case '/inventory':
      return { titleKey: 'inventory', section: 'inventory', trail: [HOME, { labelKey: 'nav_inventory' }], auth: false, width: 'wide', needsHeading: false, inlineErrors: true };
    case '/catalog':
      return { titleKey: 'catalog', section: 'services', trail: [HOME, { labelKey: 'nav_catalog' }], auth: false, width: 'wide', needsHeading: false, inlineErrors: true };
    case '/clients':
      return { titleKey: 'clients', section: 'clients', trail: [HOME, { labelKey: 'nav_clients' }], auth: false, width: 'wide', needsHeading: false };
    case '/more':
      return { titleKey: 'nav_settings', section: 'settings', trail: [HOME, { labelKey: 'nav_settings' }], auth: false, width: 'wide', needsHeading: false };
    case '/categories':
      return { titleKey: 'manage_categories', section: 'settings', trail: [HOME, SETTINGS, { labelKey: 'manage_categories' }], auth: false, width: 'form', needsHeading: false };
    case '/business':
      return { titleKey: 'business_settings', section: 'settings', trail: [HOME, SETTINGS, { labelKey: 'business_settings' }], auth: false, width: 'form', needsHeading: false };
    case '/subscription':
      // Pantalla completa tanto en onboarding (recién registrado) como al gestionar el plan desde Ajustes:
      // el checkout no debe competir con la barra lateral ni con las migas.
      return { titleKey: 'subscription_title', section: null, trail: [{ labelKey: 'subscription_title' }], auth: false, width: 'form', needsHeading: false, hideFloating: true, standalone: true };
    case '/profile':
      return { titleKey: 'profile', section: 'settings', trail: [HOME, SETTINGS, { labelKey: 'profile' }], auth: false, width: 'form', needsHeading: false };
    case '/employees':
      return { titleKey: 'nav_employees', section: 'employees', trail: [HOME, { labelKey: 'nav_employees' }], auth: false, width: 'wide', needsHeading: false };
    case '/loyalty':
      return { titleKey: 'nav_loyalty', section: 'loyalty', trail: [HOME, LOYALTY], auth: false, width: 'wide', needsHeading: false };
    case '/cash-opening':
      return { titleKey: 'cash_opening_title', section: 'home', icon: 'wallet', trail: [HOME, { labelKey: 'crumb_cash' }], auth: false, width: 'form', needsHeading: false };
    case '/sales-today':
      return { titleKey: 'nav_sales_today', section: 'home', icon: 'coins', trail: [HOME, { labelKey: 'nav_sales_today' }], auth: false, width: 'wide', needsHeading: false, inlineErrors: true };
    case '/sale/new':
      // Como el checkout del plan: pantalla enfocada, sin el WhatsApp/asistente flotantes tapando el carrito o el pago.
      return { titleKey: 'sale_new_title', section: 'home', icon: 'coins', trail: [HOME, { labelKey: 'sale_new_title' }], auth: false, width: 'wide', needsHeading: false, hideFloating: true };
    case '/cash-close':
      return { titleKey: 'nav_cash_close', section: 'home', icon: 'wallet', trail: [HOME, { labelKey: 'nav_cash_close' }], auth: false, width: 'wide', needsHeading: false, inlineErrors: true };
    case '/share':
      return { titleKey: 'share_whatsapp', section: 'services', trail: [SERVICES, { labelKey: 'crumb_send' }], auth: false, width: 'form', needsHeading: false };
    case '/item/form': {
      const key = editing ? 'item_edit' : 'item_new';
      return { titleKey: key, section: 'inventory', trail: [HOME, INVENTORY, { labelKey: key }], auth: false, width: 'form', needsHeading: false };
    }
    case '/client/form': {
      const key = editing ? 'client_edit' : 'client_new';
      return { titleKey: key, section: 'clients', trail: [HOME, CLIENTS, { labelKey: key }], auth: false, width: 'form', needsHeading: false };
    }
    case '/welcome':
      // La bienvenida web trae su propio <h1> dentro de la tarjeta de acceso y ocupa toda la ventana.
      return AUTH('welcome_title', { bleed: true });
    case '/login':
      return AUTH('login');
    case '/register':
      return AUTH('create_account');
    case '/recover':
      return AUTH('recover_title');
    case '/verify':
      return AUTH('verify_title');
    case '/reset':
      return AUTH('reset_title');
    case '/terms':
      return AUTH('terms_page_title');
    case '/privacy':
      return AUTH('privacy_page_title');
  }

  if (/^\/item\/[^/]+$/.test(path)) return { titleKey: 'item_details', section: 'inventory', trail: [HOME, INVENTORY, { labelKey: 'crumb_detail' }], auth: false, width: 'wide', needsHeading: false };
  if (/^\/catalog-item\/[^/]+$/.test(path)) return { titleKey: 'catalog', section: 'services', trail: [HOME, SERVICES, { labelKey: 'crumb_detail' }], auth: false, width: 'wide', needsHeading: false };
  if (/^\/client\/[^/]+$/.test(path)) return { titleKey: 'clients', section: 'clients', trail: [HOME, CLIENTS, { labelKey: 'crumb_detail' }], auth: false, width: 'wide', needsHeading: false };

  return { titleKey: 'app_name', section: null, trail: [{ labelKey: 'app_name' }], auth: false, width: 'wide', needsHeading: false };
}
