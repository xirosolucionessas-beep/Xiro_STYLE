/**
 * Variante WEB de src/ui/ConnectionError.tsx (Metro la usa solo en web). Al abrir la app sin poder conectar con el servidor:
 * tarjeta centrada, oscura y dorada con fondo desenfocado, ícono de "sin conexión" y un botón "Reintentar conexión"
 * contenido, centrado y de ancho automático, con indicador de carga mientras reintenta.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useSettings } from '@/lib/settings';
import { Ico } from '@/web/icons';
import { Button } from '@/web/ui/Button';
import { useWebStyles } from '@/web/ui/shared';

/** Tiempo mínimo que se ve el indicador al reintentar, para que el clic siempre tenga respuesta visible. */
const MIN_SPINNER_MS = 900;

export function ConnectionError({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  useWebStyles();
  const { t } = useSettings();
  const titleId = useId();
  const messageId = useId();
  const [pressed, setPressed] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    wrap.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!pressed) return;
    const id = setTimeout(() => setPressed(false), MIN_SPINNER_MS);
    return () => clearTimeout(id);
  }, [pressed]);

  return (
    <main className="xw-conn xw-scope-dark">
      <div ref={wrap} role="alert" aria-labelledby={titleId} aria-describedby={messageId} className="xw-errcard">
        <span className="xw-errcard-ic" aria-hidden="true">
          <Ico name="wifi-off" size={30} />
        </span>
        <h1 id={titleId} className="xw-errcard-title">
          {t('conn_title')}
        </h1>
        <p id={messageId} className="xw-errcard-msg">
          {t('offline_error')}
        </p>
        <Button
          loading={pressed || retrying}
          loadingLabel={t('loading')}
          icon={<Ico name="refresh" size={18} />}
          onPress={() => {
            setPressed(true);
            onRetry();
          }}>
          {t('conn_retry')}
        </Button>
      </div>
    </main>
  );
}
