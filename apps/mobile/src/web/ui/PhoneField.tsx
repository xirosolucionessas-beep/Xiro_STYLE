import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { COUNTRIES, countryByCode, type CountryCode } from '../data/countries';
import { Flag } from '../flags';
import { Ico } from '../icons';
import { useShellMode } from '../shell/hooks';
import { CountrySheetList } from './CountrySheetList';
import { describedBy, FieldShell } from './Input';
import { Modal } from './Modal';
import { cx, useFieldIds, useWebStyles } from './shared';

export interface PhoneFieldProps {
  label: string;
  country: CountryCode;
  onCountryChange: (code: CountryCode) => void;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  id?: string;
  name?: string;
  /** Textos de la hoja inferior (móvil). */
  sheetSearchPlaceholder: string;
  sheetCloseLabel: string;
  sheetNoResultsLabel: string;
}

/**
 * Campo de celular con selector de código de país (bandera + nombre + prefijo, ej. "🇨🇴 Colombia +57"): reemplaza
 * el prefijo estático de texto por un selector real. En escritorio/tablet, un combobox ARIA "select-only" compacto
 * (solo bandera + prefijo en el botón cerrado, para convivir con el número en la misma fila); en móvil, una hoja
 * inferior con buscador, como CountryPicker.
 */
export function PhoneField({ label, country, onCountryChange, value, onChange, error, id, name, sheetSearchPlaceholder, sheetCloseLabel, sheetNoResultsLabel }: PhoneFieldProps) {
  useWebStyles();
  const mobile = useShellMode() === 'mobile';
  const ids = useFieldIds(id);
  const comboId = useId();
  const listId = `${comboId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, COUNTRIES.findIndex((c) => c.code === country)));
  const root = useRef<HTMLDivElement>(null);
  const selected = countryByCode(country);

  useEffect(() => {
    if (!open || mobile) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, mobile]);

  const openList = () => {
    setActive(Math.max(0, COUNTRIES.findIndex((c) => c.code === country)));
    setOpen(true);
  };
  const choose = (index: number) => {
    onCountryChange(COUNTRIES[index]!.code);
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
    <div className="xw-phone-wrap" ref={root}>
      <FieldShell label={label} error={error} ids={ids}>
        {mobile ? (
          <button type="button" className="xw-phone-dial" aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${selected.name} +${selected.dial}`} onClick={() => setOpen(true)}>
            <Flag code={selected.code} width={22} />
            <span className="xw-phone-dial-code">+{selected.dial}</span>
            <Ico name="chevron-down" size={16} />
          </button>
        ) : (
          <button
            type="button"
            role="combobox"
            className="xw-phone-dial"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={`${label}: ${selected.name} +${selected.dial}`}
            aria-activedescendant={open ? `${comboId}-opt-${active}` : undefined}
            onClick={() => (open ? setOpen(false) : openList())}
            onKeyDown={onKeyDown}>
            <Flag code={selected.code} width={22} />
            <span className="xw-phone-dial-code">+{selected.dial}</span>
            <Ico name="chevron-down" size={16} />
          </button>
        )}
        <input
          id={ids.id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          name={name}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ids, undefined, error)}
          onChange={(event) => onChange(event.target.value)}
        />
      </FieldShell>
      {open && !mobile ? (
        <div className="xw-cp-list xw-phone-list" role="listbox" id={listId} aria-label={label}>
          {COUNTRIES.map((c, index) => (
            // Las opciones se manejan desde el combobox (teclado); el clic es el atajo de ratón.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <div
              key={c.code}
              id={`${comboId}-opt-${index}`}
              role="option"
              aria-selected={c.code === country}
              tabIndex={-1}
              className={cx('xw-cp-opt', index === active && 'is-active', c.code === country && 'is-selected')}
              onMouseMove={(event) => (event.movementX !== 0 || event.movementY !== 0) && setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}>
              <Flag code={c.code} width={26} />
              <span className="xw-cp-name">{c.name}</span>
              <span className="xw-cp-dial">+{c.dial}</span>
              <span className="xw-cp-check" aria-hidden="true">
                {c.code === country ? <Ico name="check" size={18} /> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {mobile ? (
        <Modal open={open} onClose={() => setOpen(false)} title={label} closeLabel={sheetCloseLabel} variant="sheet">
          <CountrySheetList
            value={country}
            onChoose={(code) => {
              onCountryChange(code);
              setOpen(false);
            }}
            searchLabel={sheetSearchPlaceholder}
            searchPlaceholder={sheetSearchPlaceholder}
            noResultsLabel={sheetNoResultsLabel}
          />
        </Modal>
      ) : null}
    </div>
  );
}
