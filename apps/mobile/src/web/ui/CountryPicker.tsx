import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { COUNTRIES, countryByCode, type CountryCode } from '../data/countries';
import { Flag } from '../flags';
import { useShellMode } from '../shell/hooks';
import { Ico } from '../icons';
import { CountrySheetList } from './CountrySheetList';
import { Modal } from './Modal';
import { cx, useWebStyles } from './shared';

export interface CountryPickerProps {
  label: string;
  value: CountryCode;
  onChange: (code: CountryCode) => void;
  hint?: string;
  /** Textos de la hoja inferior (móvil): título del diálogo, marcador del buscador, "cerrar" y "sin resultados". */
  sheetSearchPlaceholder: string;
  sheetCloseLabel: string;
  sheetNoResultsLabel: string;
}

/**
 * Selector de país con banderas SVG (un <select> nativo no puede mostrar imágenes). En escritorio/tablet, un
 * combobox ARIA "select-only" (flechas/Inicio/Fin, Enter/espacio, Escape, primera letra); en móvil, una hoja
 * inferior con buscador — más fácil de tocar y de encontrar el país que un desplegable angosto.
 */
export function CountryPicker({ label, value, onChange, hint, sheetSearchPlaceholder, sheetCloseLabel, sheetNoResultsLabel }: CountryPickerProps) {
  useWebStyles();
  const mobile = useShellMode() === 'mobile';
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, COUNTRIES.findIndex((c) => c.code === value)));
  const root = useRef<HTMLDivElement>(null);
  const selected = countryByCode(value);

  useEffect(() => {
    if (!open || mobile) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, mobile]);

  const openList = () => {
    setActive(Math.max(0, COUNTRIES.findIndex((c) => c.code === value)));
    setOpen(true);
  };
  const choose = (index: number) => {
    onChange(COUNTRIES[index]!.code);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = COUNTRIES.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else setActive((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActive(last);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) choose(active);
        else openList();
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        break;
      case 'Tab':
        if (open) setOpen(false);
        break;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const start = (active + 1) % COUNTRIES.length;
          const order = [...COUNTRIES.slice(start), ...COUNTRIES.slice(0, start)];
          const match = order.find((c) => c.name.toLowerCase().startsWith(event.key.toLowerCase()));
          if (match) {
            if (!open) setOpen(true);
            setActive(COUNTRIES.indexOf(match));
          }
        }
    }
  };

  return (
    <div className="xw-field xw-cp" ref={root}>
      <span className="xw-label" id={labelId}>
        {label}
      </span>
      <div className="xw-cp-anchor">
      {mobile ? (
        <button
          type="button"
          className={cx('xw-control', 'xw-cp-btn')}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          onClick={() => setOpen(true)}>
          <Flag code={selected.code} width={26} />
          <span className="xw-cp-name">{selected.name}</span>
          <span className="xw-cp-dial">+{selected.dial}</span>
          <Ico name="chevron-down" size={18} />
        </button>
      ) : (
        <button
          type="button"
          role="combobox"
          className={cx('xw-control', 'xw-cp-btn')}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}>
          <Flag code={selected.code} width={26} />
          <span className="xw-cp-name">{selected.name}</span>
          <span className="xw-cp-dial">+{selected.dial}</span>
          <Ico name="chevron-down" size={18} />
        </button>
      )}
      {open && !mobile ? (
        <div className="xw-cp-list" role="listbox" id={listId} aria-labelledby={labelId}>
          {COUNTRIES.map((country, index) => (
            // Las opciones se manejan desde el combobox (teclado); el clic es el atajo de ratón.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <div
              key={country.code}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={country.code === value}
              tabIndex={-1}
              className={cx('xw-cp-opt', index === active && 'is-active', country.code === value && 'is-selected')}
              // Solo el movimiento REAL del ratón cambia la opción activa (un cursor quieto bajo la lista no debe desviar al teclado).
              onMouseMove={(event) => (event.movementX !== 0 || event.movementY !== 0) && setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}>
              <Flag code={country.code} width={26} />
              <span className="xw-cp-name">{country.name}</span>
              <span className="xw-cp-dial">+{country.dial}</span>
              <span className="xw-cp-check" aria-hidden="true">
                {country.code === value ? <Ico name="check" size={18} /> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      </div>
      {mobile ? (
        <Modal open={open} onClose={() => setOpen(false)} title={label} closeLabel={sheetCloseLabel} variant="sheet">
          <CountrySheetList
            value={value}
            onChoose={(code) => {
              onChange(code);
              setOpen(false);
            }}
            searchLabel={sheetSearchPlaceholder}
            searchPlaceholder={sheetSearchPlaceholder}
            noResultsLabel={sheetNoResultsLabel}
          />
        </Modal>
      ) : null}
      {hint ? (
        <p className="xw-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
