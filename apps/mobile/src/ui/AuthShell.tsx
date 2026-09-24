import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Brand } from './Brand';
import { Header, Screen } from './Screen';
import { AppText } from './Text';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  hideBack?: boolean;
  showBrand?: boolean;
}

export function AuthShell({ title, subtitle, children, hideBack, onBack, showBrand }: AuthShellProps) {
  return (
    <Screen header={hideBack ? undefined : <Header title="" onBack={onBack} />}>
      <View style={styles.body}>
        {showBrand ? <Brand size={72} /> : null}
        <AppText variant="display" style={styles.title}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText tone="muted" style={styles.subtitle}>
            {subtitle}
          </AppText>
        ) : null}
        {children}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 4 },
  title: { marginTop: 12 },
  subtitle: { marginTop: 8, marginBottom: 22 },
});
