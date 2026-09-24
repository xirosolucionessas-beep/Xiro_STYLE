/**
 * Variante WEB de src/ui/Dialogs.tsx: confirmaciones con el Modal accesible del kit (role=dialog, foco atrapado,
 * Escape, retorno del foco) y avisos con regiones role=status. Mismo API que la nativa.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSettings } from '@/lib/settings';
import { tw } from '@/web/shell/strings';
import { Button, Modal, ToastProvider, useToast } from '@/web/ui';
import type * as Native from './Dialogs';

type DialogsValue = ReturnType<typeof Native.useDialogs>;
type ConfirmOptions = Parameters<DialogsValue['confirm']>[0];

const DialogsContext = createContext<DialogsValue | null>(null);

function ConfirmHost({ children }: { children: ReactNode }) {
  const { language } = useSettings();
  const { show } = useToast();
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })), []);
  const toast = useCallback((message: string) => void show(message, { tone: 'info' }), [show]);
  const value = useMemo(() => ({ confirm, toast }), [confirm, toast]);

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <DialogsContext.Provider value={value}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => finish(false)}
        title={pending?.title ?? ''}
        closeLabel={tw(language, 'close')}
        footer={
          <>
            <Button variant="ghost" size="sm" onPress={() => finish(false)}>
              {tw(language, 'cancel')}
            </Button>
            <Button variant={pending?.destructive ? 'danger' : 'primary'} size="sm" onPress={() => finish(true)}>
              {pending?.confirmLabel ?? tw(language, 'yes')}
            </Button>
          </>
        }>
        {pending?.message ? <p style={{ margin: 0, color: 'var(--xw-text-muted)', lineHeight: 1.5 }}>{pending.message}</p> : null}
      </Modal>
    </DialogsContext.Provider>
  );
}

export function DialogsProvider({ children }: { children: ReactNode }) {
  const { language } = useSettings();
  return (
    <ToastProvider dismissLabel={tw(language, 'close_notice')}>
      <ConfirmHost>{children}</ConfirmHost>
    </ToastProvider>
  );
}

export function useDialogs(): DialogsValue {
  const value = useContext(DialogsContext);
  if (!value) throw new Error('useDialogs debe usarse dentro de DialogsProvider');
  return value;
}
