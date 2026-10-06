const STARS = [1, 2, 3, 4, 5];

/** Selector de calificación de 1 a 5 estrellas, accesible como un grupo de radios (el número siempre va en el texto). */
export function StarRating({ value, onChange, label, starLabel }: { value: number; onChange: (value: number) => void; label: string; starLabel: (n: number) => string }) {
  return (
    <div className="xp-stars-input" role="radiogroup" aria-label={label}>
      {STARS.map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={starLabel(n)} className="xp-star-btn" onClick={() => onChange(n)}>
          <span aria-hidden="true">{n <= value ? '★' : '☆'}</span>
        </button>
      ))}
    </div>
  );
}
