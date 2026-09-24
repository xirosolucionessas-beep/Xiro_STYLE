import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Ico } from '../icons';
import { Button } from './Button';
import { cx, useWebStyles } from './shared';
import { WebcamModal, prefersDeviceCamera, webcamSupported } from './WebcamModal';

type T = (key: string) => string;

/** Límite del servidor (5 MB tras procesar). Antes de procesar se acepta más: la imagen se reduce a 1600 px y se comprime. */
export const MAX_PICK_BYTES = 20 * 1024 * 1024;

export interface PickedPhoto {
  /** URL local (blob:) para la vista previa y para procesar. */
  uri: string;
  width: number;
  name: string;
}

/** Devuelve la clave de error si el archivo no sirve; null si es válido. */
export function validatePhotoFile(file: { type: string; size: number }): 'photo_type' | 'photo_size' | null {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) return 'photo_type';
  return file.size > MAX_PICK_BYTES ? 'photo_size' : null;
}

function measure(uri: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth);
    image.onerror = () => reject(new Error('unreadable'));
    image.src = uri;
  });
}

/**
 * Zona de foto opcional (paso 3 del registro): área grande con "+", vista previa con cambiar/quitar,
 * "Subir foto" (archivo) y "Tomar foto" (cámara del dispositivo en móvil; cámara web con vista previa en escritorio).
 */
export function PhotoPicker({ photo, onChange, t }: { photo: PickedPhoto | null; onChange: (photo: PickedPhoto | null) => void; t: T }) {
  useWebStyles();
  const fileInput = useRef<HTMLInputElement>(null);
  const deviceCamera = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const current = useRef<string | null>(null);

  // Libera la URL local anterior al cambiar o quitar la foto, y al desmontar.
  useEffect(() => {
    if (current.current && current.current !== photo?.uri) URL.revokeObjectURL(current.current);
    current.current = photo?.uri ?? null;
  }, [photo]);
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );

  const accept = async (file: Blob, name: string) => {
    const problem = validatePhotoFile(file);
    if (problem) return setError(t(problem));
    const uri = URL.createObjectURL(file);
    try {
      const width = await measure(uri);
      setError(null);
      onChange({ uri, width, name });
    } catch {
      URL.revokeObjectURL(uri);
      setError(t('photo_type'));
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // permite volver a elegir el mismo archivo
    if (file) void accept(file, file.name);
  };

  const takePhoto = () => {
    if (prefersDeviceCamera() || !webcamSupported()) deviceCamera.current?.click();
    else setCameraOpen(true);
  };

  return (
    <div className="xw-photo">
      <div className={cx('xw-photo-zone', photo && 'has-photo')}>
        {photo ? (
          <>
            <img className="xw-photo-img" src={photo.uri} alt={t('photo_alt')} />
            <div className="xw-photo-actions">
              <Button size="sm" variant="secondary" onPress={() => fileInput.current?.click()}>
                {t('photo_change')}
              </Button>
              <Button size="sm" variant="ghost" onPress={() => onChange(null)}>
                {t('photo_remove')}
              </Button>
            </div>
          </>
        ) : (
          <button type="button" className="xw-photo-empty" onClick={() => fileInput.current?.click()}>
            <span className="xw-photo-plus" aria-hidden="true">
              <Ico name="plus" size={28} />
            </span>
            <span className="xw-photo-title">{t('photo_title')}</span>
            <span className="xw-photo-optional">{t('optional')}</span>
          </button>
        )}
      </div>
      <p className="xw-hint">{t('photo_help')}</p>

      <div className="xw-photo-buttons">
        <Button variant="secondary" fullWidth icon={<Ico name="image" size={18} />} onPress={() => fileInput.current?.click()}>
          {t('photo_upload')}
        </Button>
        <Button variant="secondary" fullWidth icon={<Ico name="camera" size={18} />} onPress={takePhoto}>
          {t('photo_take')}
        </Button>
      </div>
      <p className="xw-error" role="alert">
        {error}
      </p>

      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="xw-sr" tabIndex={-1} aria-hidden="true" onChange={onFile} />
      <input ref={deviceCamera} type="file" accept="image/*" capture="environment" className="xw-sr" tabIndex={-1} aria-hidden="true" onChange={onFile} />

      <WebcamModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        t={t}
        onCapture={(blob) => {
          setCameraOpen(false);
          void accept(blob, 'photo.jpg');
        }}
      />
    </div>
  );
}
