import type { Requirement } from '../../lib/access';
import type { IconName } from '../ui/shared';
import type { SectionId } from './routes';

export interface NavItem {
  id: string;
  labelKey: string;
  icon: IconName;
  /** Sección de `describeRoute` que marca este ítem como activo. */
  section?: SectionId;
  href?: string;
  /** Quién lo ve en el menú (sin esto, cualquiera con sesión). El servidor impone lo mismo en cada petición. */
  requires?: Requirement;
  /** Módulo aún no disponible: se muestra como texto con la etiqueta "Próximamente". */
  soon?: boolean;
}

/** Orden de la barra lateral. Editar aquí para añadir/quitar secciones. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'home', labelKey: 'nav_home', icon: 'home', section: 'home', href: '/' },
  { id: 'agenda', labelKey: 'nav_agenda', icon: 'calendar', section: 'agenda', href: '/agenda', requires: ['agenda_own'] },
  // Pedidos de solo productos de la página pública: los atiende quien registra ventas (entregar = registrar la venta).
  { id: 'orders', labelKey: 'nav_orders', icon: 'bag', section: 'orders', href: '/orders', requires: ['services_record'] },
  { id: 'booking', labelKey: 'nav_booking', icon: 'globe', section: 'booking', href: '/booking', requires: ['public_page_manage'] },
  { id: 'clients', labelKey: 'nav_clients', icon: 'users', section: 'clients', href: '/clients', requires: ['clients_view'] },
  { id: 'services', labelKey: 'nav_catalog', icon: 'book', section: 'services', href: '/catalog', requires: ['catalog_view'] },
  { id: 'inventory', labelKey: 'nav_inventory', icon: 'box', section: 'inventory', href: '/inventory', requires: ['catalog_view'] },
  { id: 'employees', labelKey: 'nav_employees', icon: 'briefcase', section: 'employees', href: '/employees', requires: 'owner' },
  { id: 'reports', labelKey: 'nav_reports', icon: 'chart', section: 'reports', href: '/reports', requires: 'owner' },
  { id: 'loyalty', labelKey: 'nav_loyalty', icon: 'star', section: 'loyalty', href: '/loyalty', requires: ['loyalty_redeem', 'services_record'] },
  { id: 'settings', labelKey: 'nav_settings', icon: 'sliders', section: 'settings', href: '/more' },
];
