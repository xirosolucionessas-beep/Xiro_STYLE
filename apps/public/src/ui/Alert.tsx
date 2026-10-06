import type { ReactNode } from 'react';

export function Alert({ tone, children }: { tone: 'danger' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div className={`xp-alert xp-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
