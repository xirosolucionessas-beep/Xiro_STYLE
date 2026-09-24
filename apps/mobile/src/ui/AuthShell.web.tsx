/** Variante WEB de src/ui/AuthShell.tsx: el título de la pantalla es un <h1> real (en la cabecera, junto al botón volver). */
import type { ComponentProps } from 'react';
import type * as Native from './AuthShell';
import { Brand } from './Brand';
import { Header, Screen } from './Screen';
import { AppText } from './Text';

type AuthShellProps = ComponentProps<typeof Native.AuthShell>;

export function AuthShell({ title, subtitle, children, hideBack, onBack, showBrand }: AuthShellProps) {
  return (
    <Screen header={<Header title={title} onBack={onBack} root={hideBack} />}>
      {showBrand ? <Brand size={72} /> : null}
      {subtitle ? (
        <AppText tone="muted" style={{ marginBottom: 22 }}>
          {subtitle}
        </AppText>
      ) : null}
      {children}
    </Screen>
  );
}
