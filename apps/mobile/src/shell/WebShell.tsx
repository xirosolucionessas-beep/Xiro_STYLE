import type { ReactNode } from 'react';

/** Nativo: sin estructura extra. La versión web (WebShell.web.tsx) añade sidebar, migas y <main>. */
export function WebShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
