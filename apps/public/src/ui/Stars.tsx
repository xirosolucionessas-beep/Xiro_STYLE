import { Icon } from './Icon';

/**
 * Estrellas de solo lectura (1 a 5). Con promedio, se llenan hasta la media estrella más cercana. Sin calificación (`null`),
 * las cinco van vacías. El valor se anuncia en texto (no solo por el color).
 */
export function Stars({ value, size = 16, label }: { value: number | null; size?: number; label: string }) {
  const rounded = value === null ? 0 : Math.round(value * 2) / 2;
  return (
    <span className="xp-stars" role="img" aria-label={label}>
      {Array.from({ length: 5 }, (_, n) => {
        const state = rounded >= n + 1 ? 'is-on' : rounded >= n + 0.5 ? 'is-half' : 'is-off';
        return (
          <span key={n} className={state}>
            <Icon name="star" size={size} />
          </span>
        );
      })}
    </span>
  );
}
