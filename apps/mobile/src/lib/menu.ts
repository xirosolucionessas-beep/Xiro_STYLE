import type { Actor } from '@xiro/shared';
import { meets, type Requirement } from './access';

/**
 * Mapa del menú lateral: TODAS las funciones de la app, agrupadas. Solo apunta a pantallas que ya existen; las que aún no
 * están disponibles (`soon`) muestran un aviso corto en vez de llevar a una pantalla vacía. Lo que cada persona puede ver
 * sale de `requires` (mismo criterio que el guardián de rutas y que el servidor: ver src/lib/access.ts).
 */
export type MenuBadge = 'low_stock';

export interface MenuItem {
  id: string;
  labelKey: string;
  /** Nombre de ícono de Ionicons. */
  icon: string;
  /** Ruta existente de la app. Sin `href` = módulo aún no disponible. */
  href?: string;
  soon?: boolean;
  requires?: Requirement;
  badge?: MenuBadge;
}

export interface MenuSection {
  id: 'main' | 'cash' | 'business' | 'assistant';
  titleKey: string;
  items: MenuItem[];
}

export const MENU_SECTIONS: MenuSection[] = [
  {
    id: 'main',
    titleKey: 'menu_section_main',
    items: [
      { id: 'home', labelKey: 'home', icon: 'home-outline', href: '/' },
      { id: 'appointments', labelKey: 'appointments', icon: 'calendar-outline', soon: true, requires: 'owner' },
      { id: 'clients', labelKey: 'clients', icon: 'people-outline', href: '/clients', requires: ['clients_view'] },
      { id: 'catalog', labelKey: 'catalog', icon: 'book-outline', href: '/catalog', requires: ['catalog_view'] },
      { id: 'inventory', labelKey: 'inventory', icon: 'cube-outline', href: '/inventory', requires: ['catalog_view'], badge: 'low_stock' },
      { id: 'team', labelKey: 'team', icon: 'people-circle-outline', href: '/employees', requires: 'owner' },
      { id: 'loyalty', labelKey: 'loyalty_title', icon: 'gift-outline', href: '/loyalty', requires: ['loyalty_redeem', 'services_record'] },
    ],
  },
  {
    id: 'cash',
    titleKey: 'menu_section_cash',
    items: [
      { id: 'cash_base', labelKey: 'menu_cash_base', icon: 'wallet-outline', href: '/cash-opening', requires: 'owner' },
      { id: 'cash_close', labelKey: 'cash_close', icon: 'cash-outline', soon: true, requires: 'owner' },
    ],
  },
  {
    id: 'business',
    titleKey: 'menu_section_business',
    items: [
      { id: 'business', labelKey: 'business_settings', icon: 'storefront-outline', href: '/business', requires: 'owner' },
      { id: 'categories', labelKey: 'manage_categories', icon: 'pricetags-outline', href: '/categories', requires: ['catalog_manage'] },
      { id: 'plan', labelKey: 'subscription_title', icon: 'star-outline', href: '/subscription', requires: 'owner' },
      { id: 'reports', labelKey: 'menu_reports', icon: 'bar-chart-outline', soon: true, requires: 'owner' },
    ],
  },
  {
    id: 'assistant',
    titleKey: 'menu_section_assistant',
    // El asistente necesita un backend con IA que todavía no existe (tampoco en la Web): se muestra como "Próximamente".
    items: [{ id: 'assistant', labelKey: 'menu_assistant', icon: 'sparkles-outline', soon: true }],
  },
];

/** Secciones e ítems que esta persona puede ver; una sección sin ítems no se muestra. */
export function menuFor(actor: Actor | null): MenuSection[] {
  return MENU_SECTIONS.map((section) => ({ ...section, items: section.items.filter((item) => meets(actor, item.requires)) })).filter((section) => section.items.length > 0);
}

/** ¿Este ítem es la pantalla actual? (Inicio solo coincide con "/", los demás con su ruta.) */
export const isCurrentItem = (item: MenuItem, pathname: string): boolean => Boolean(item.href) && (item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`));
