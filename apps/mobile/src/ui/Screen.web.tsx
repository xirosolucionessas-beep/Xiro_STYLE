/**
 * Variante WEB de src/ui/Screen.tsx (Metro la usa solo en web). Mismo API que la nativa; el <main> lo aporta el shell.
 * El contenido hace scroll dentro de la pantalla (la app ocupa el alto de la ventana) y se centra hasta el ancho máximo.
 */
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useSettings } from '@/lib/settings';
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

export function Header({ title, subtitle, onBack, right, root }: HeaderProps) {
  useWebStyles();
  const { t } = useSettings();
  const router = useRouter();
  // Vuelve con el historial real del navegador; sin historial (entrada directa) va al inicio sin apilar otra entrada.
  const goBack = () => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <div className="xw-head">
      {!root ? (
        <button type="button" className="xw-back" aria-label={t('back')} onClick={goBack}>
          <Icon name="arrow-left" size={22} />
        </button>
      ) : null}
      <div className="xw-head-text">
        {title ? <h1 className="xw-h1">{title}</h1> : null}
        {subtitle ? <p className="xw-sub">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}
