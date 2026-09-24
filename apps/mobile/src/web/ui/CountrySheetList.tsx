import { useId, useMemo, useState } from 'react';
import { COUNTRIES, type CountryCode } from '../data/countries';
import { Flag } from '../flags';
import { Ico } from '../icons';
import { cx } from './shared';

/**
 * Contenido de la hoja inferior de país (móvil): buscador + lista grande con bandera, nombre y prefijo. Lo comparten
 * CountryPicker (país del negocio) y PhoneField (código del celular) dentro de un <Modal variant="sheet">.
 */
/** Sin tildes/diacríticos ni mayúsculas: "mexico" o "MÉXICO" deben encontrar "México" igual que "méxico". */
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function CountrySheetList({ value, onChoose, searchLabel, searchPlaceholder, noResultsLabel }: { value: CountryCode; onChoose: (code: CountryCode) => void; searchLabel: string; searchPlaceholder: string; noResultsLabel: string }) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const filtered = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => fold(c.name).includes(q) || c.dial.includes(q));
  }, [query]);

  return (
    <div className="xw-cs">
      <div className="xw-control xw-cs-search">
        <Ico name="search" size={18} />
        <input id={inputId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} aria-label={searchLabel} autoComplete="off" autoCapitalize="none" autoCorrect="off" />
      </div>
      <ul className="xw-cs-list">
        {filtered.map((c) => (
          <li key={c.code}>
            <button type="button" aria-current={c.code === value} className={cx('xw-cs-opt', c.code === value && 'is-selected')} onClick={() => onChoose(c.code)}>
              <Flag code={c.code} width={32} />
              <span className="xw-cp-name">{c.name}</span>
              <span className="xw-cp-dial">+{c.dial}</span>
              {c.code === value ? (
                <span className="xw-cp-check" aria-hidden="true">
                  <Ico name="check" size={20} />
                </span>
              ) : null}
            </button>
          </li>
        ))}
        {filtered.length === 0 ? <li className="xw-cs-empty">{noResultsLabel}</li> : null}
      </ul>
    </div>
  );
}
