import { useCallback, useState } from 'react';
import { apiErrors } from '@/lib/forms';
import { useSettings } from '@/lib/settings';

/**
 * Ejecuta una acción de guardado con estado de "ocupado" y errores ya traducidos: `fields` (por campo) y `error` (general).
 * Devuelve `undefined` si falló, para que quien llama solo continúe cuando salió bien.
 */
export function useAction() {
  const { t } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});

  const run = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(undefined);
      setFields({});
      try {
        return await work();
      } catch (e) {
        const result = apiErrors(e, t);
        setFields(result.fields);
        setError(result.general ?? (Object.keys(result.fields).length > 0 ? t('appt_err_fix') : undefined));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const clear = useCallback(() => {
    setError(undefined);
    setFields({});
  }, []);

  return { busy, error, fields, run, clear, setError };
}
