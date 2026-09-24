import type { ReactNode } from 'react';
import { useWebStyles, VisuallyHidden } from './shared';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Radio en px. */
  radius?: number;
}

/** Bloque de carga puramente visual (oculto a lectores de pantalla). */
export function Skeleton({ width = '100%', height = 16, radius = 8 }: SkeletonProps) {
  useWebStyles();
  return <span className="xw-skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius }} />;
}

/** Agrupa skeletons y anuncia UNA sola vez el estado de carga. */
export function SkeletonGroup({ label, children }: { label: string; children: ReactNode }) {
  useWebStyles();
  return (
    <div role="status" aria-busy="true" style={{ display: 'grid', gap: 12 }}>
      <VisuallyHidden>{label}</VisuallyHidden>
      {children}
    </div>
  );
}
