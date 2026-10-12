/**
 * Variante WEB de src/ui/Screen.tsx (Metro la usa solo en web). Mismo API que la nativa; el <main> lo aporta el shell.
 * El contenido hace scroll dentro de la pantalla (la app ocupa el alto de la ventana) y se centra hasta el ancho máximo.
 */
import { usePathname, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useSettings } from '@/lib/settings';
import { Ico, type IconName } from '@/web/icons';
import { describeRoute, type SectionId } from '@/web/shell/routes';
import { Icon, useWebStyles } from '@/web/ui/shared';
import type * as Native from './Screen';

type ScreenProps = ComponentProps<typeof Native.Screen>;
type HeaderProps = ComponentProps<typeof Native.Header>;

export function Screen({ children, footer, header }: ScreenProps) {
  useWebStyles();
  return (
    <div className="xw-screen">
      {header}
      <div className="xw-scroll">
        <div className="xw-page">{children}</div>
      </div>
      {footer ? <div className="xw-foot">{footer}</div> : null}
    </div>
  );
}

/** Icono de la sección a la que pertenece la pantalla (las sub-pantallas heredan el de su sección). */
const SECTION_ICON: Record<SectionId, IconName> = { home: 'house', notifications: 'bell', messages: 'message-square', agenda: 'calendar-days', orders: 'shopping-bag', booking: 'globe', reports: 'bar-chart', clients: 'users', services: 'book-open', inventory: 'package', loyalty: 'gift', employees: 'briefcase', settings: 'sliders' };

export function Header({ title, subtitle, onBack, right, root }: HeaderProps) {
  useWebStyles();
  const { t } = useSettings();
  const router = useRouter();
  const route = describeRoute(usePathname());
  // El ícono es el de la propia pantalla si lo define (p. ej. Ventas de hoy no debe mostrar la casa solo porque su
  // acceso vive en la sección "Inicio" de la barra lateral); si no, el de su sección.
  const icon = route.icon ?? (route.section ? SECTION_ICON[route.section] : undefined);
  // Vuelve con el historial real del navegador; sin historial (entrada directa) va al inicio sin apilar otra entrada.
  const goBack = () => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <div className="xw-head">
      {!root ? (
        <button type="button" className="xw-back" aria-label={t('back')} onClick={goBack}>
          <Icon name="arrow-left" size={22} />
        </button>
      ) : null}
      {icon ? (
        <span className="xw-head-ic" aria-hidden="true">
          <Ico name={icon} size={26} />
        </span>
      ) : null}
      <div className="xw-head-text">
        {title ? <h1 className="xw-h1">{title}</h1> : null}
        {subtitle ? <p className="xw-sub">{subtitle}</p> : null}
      </div>
      {right ? <div className="xw-head-actions">{right}</div> : null}
    </div>
  );
}
