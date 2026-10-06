import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { AppText } from './Text';
import { radius } from './theme';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface DialogsValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (message: string) => void;
}

const DialogsContext = createContext<DialogsValue | null>(null);

/** Diálogos y avisos propios: Alert.alert no funciona en web. */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const { colors, t } = useSettings();
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })), []);
  const toast = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2800);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const value = useMemo(() => ({ confirm, toast }), [confirm, toast]);

  return (
    <DialogsContext.Provider value={value}>
      {children}
      <Modal transparent visible={pending !== null} animationType="fade" onRequestClose={() => finish(false)}>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={() => finish(false)}>
          <Pressable style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => undefined}>
            <AppText variant="heading">{pending?.title}</AppText>
            {pending?.message ? (
              <AppText tone="muted" style={styles.message}>
                {pending.message}
              </AppText>
            ) : null}
            <View style={styles.actions}>
              <Button label={t('cancel')} variant="ghost" compact onPress={() => finish(false)} />
              <Button label={pending?.confirmLabel ?? t('yes')} variant={pending?.destructive ? 'danger' : 'primary'} compact onPress={() => finish(true)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {message ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <View style={[styles.toast, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} accessibilityLiveRegion="polite">
            <AppText variant="bodyStrong">{message}</AppText>
          </View>
        </View>
      ) : null}
    </DialogsContext.Provider>
  );
}

export function useDialogs(): DialogsValue {
  const value = useContext(DialogsContext);
  if (!value) throw new Error('useDialogs debe usarse dentro de DialogsProvider');
  return value;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, borderRadius: radius.xl, borderWidth: 1, padding: 22 },
  message: { marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 90, alignItems: 'center', paddingHorizontal: 20 },
  toast: { borderWidth: 1, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 18, maxWidth: 480 },
});
