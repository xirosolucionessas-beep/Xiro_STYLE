import { translate, type Language } from '@xiro/shared';
import { Button } from '../ui/Button';

/**
 * Botón "Reservar cita" fijo abajo en celular: aparece en cuanto el del encabezado sale de pantalla, así que siempre hay uno a la
 * vista. Respeta el área segura de los teléfonos con barra de gestos.
 */
export function StickyBook({ visible, language, onBook }: { visible: boolean; language: Language; onBook: () => void }) {
  return (
    <div className={`xp-sticky${visible ? ' is-visible' : ''}`} aria-hidden={!visible}>
      <div className="xp-container">
        <Button size="lg" onClick={onBook} tabIndex={visible ? 0 : -1}>
          {translate(language, 'pub_book_cta')}
        </Button>
      </div>
    </div>
  );
}
