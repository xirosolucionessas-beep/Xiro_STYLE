/** Bloque de carga (shimmer sutil; sin movimiento si la persona pidió menos animación): evita pantallas en blanco mientras llegan los datos. */
export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`xp-skel ${className}`} style={style} aria-hidden="true" />;
}

export function ProfileSkeleton({ label }: { label: string }) {
  return (
    <div className="xp-page" role="status" aria-busy="true" aria-label={label}>
      <Skeleton className="xp-skel-cover" />
      <div className="xp-container xp-identity">
        <Skeleton className="xp-skel-logo" />
        <Skeleton className="xp-skel-line" style={{ width: '60%', height: 30 }} />
        <Skeleton className="xp-skel-line" style={{ width: '80%' }} />
        <Skeleton className="xp-skel-line" style={{ width: '45%' }} />
        <Skeleton className="xp-skel-btn" />
      </div>
      <div className="xp-container xp-main">
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="xp-stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="xp-card xp-skel-card">
          <Skeleton className="xp-skel-line" style={{ width: '55%', height: 20 }} />
          <Skeleton className="xp-skel-line" style={{ width: '90%' }} />
          <Skeleton className="xp-skel-line" style={{ width: '35%' }} />
        </div>
      ))}
    </div>
  );
}
