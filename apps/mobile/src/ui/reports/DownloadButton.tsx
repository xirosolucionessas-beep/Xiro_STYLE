import type { ComponentProps } from 'react';
import { useState } from 'react';
import { errorKey } from '@/lib/api';
import { saveFile } from '@/lib/exports/saveFile';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { useDialogs } from '../Dialogs';

/**
 * Botón que pide un archivo al servidor (PDF o Excel) y lo guarda: en la web se descarga; en el teléfono se abre la hoja de
 * compartir. Muestra la carga mientras tanto y avisa si algo falla (p. ej. "máximo 12 meses").
 */
export function DownloadButton({
  label,
  icon,
  fileName,
  kind,
  fetchFile,
  disabled,
}: {
  label: string;
  icon?: ComponentProps<typeof Button>['icon'];
  fileName: string;
  kind: 'pdf' | 'xlsx';
  fetchFile: () => Promise<Uint8Array>;
  disabled?: boolean;
}) {
  const { t } = useSettings();
  const { toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const result = await saveFile(fileName, await fetchFile(), kind, label);
      if (result === 'saved') toast(t('bal_download_done'));
      if (result === 'unavailable') toast(t('bal_download_unavailable'));
    } catch (error) {
      toast(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  };
  return <Button label={label} icon={icon ?? (kind === 'pdf' ? 'document-text-outline' : 'grid-outline')} variant="secondary" compact loading={busy} disabled={disabled} onPress={() => void run()} />;
}
