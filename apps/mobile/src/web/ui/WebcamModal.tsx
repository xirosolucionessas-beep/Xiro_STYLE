import { useEffect, useRef, useState } from 'react';
import { Ico } from '../icons';
import { Button } from './Button';
import { Modal } from './Modal';
import { useWebStyles } from './shared';

type T = (key: string) => string;

export type WebcamState = 'starting' | 'ready' | 'denied' | 'unsupported';

/** ¿Hay cámara web utilizable? (getUserMedia solo existe en contextos seguros: https o localhost.) */
export const webcamSupported = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

/** Pantalla táctil (teléfono/tableta): allí es mejor abrir la cámara del dispositivo con <input capture>. */
export const prefersDeviceCamera = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

interface WebcamModalProps {
  open: boolean;
  onClose: () => void;
  /** Recibe un JPEG; nada se guarda ni se envía desde aquí. */
  onCapture: (photo: Blob) => void;
  t: T;
}

/**
 * Vista previa de la cámara web con botón "Capturar". Pide permiso solo al abrir; al cerrar apaga la cámara (la luz del equipo).
 * El diálogo interno se monta solo mientras está abierto, así cada apertura empieza limpia.
 */
export function WebcamModal(props: WebcamModalProps) {
  return props.open ? <WebcamDialog {...props} /> : null;
}

function WebcamDialog({ onClose, onCapture, t }: WebcamModalProps) {
  useWebStyles();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<WebcamState>(() => (webcamSupported() ? 'starting' : 'unsupported'));

  useEffect(() => {
    if (!webcamSupported()) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then((media) => {
        if (cancelled) return media.getTracks().forEach((track) => track.stop());
        stream = media;
        if (video.current) {
          video.current.srcObject = media;
          void video.current.play().catch(() => undefined);
        }
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('denied');
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const capture = () => {
    const element = video.current;
    if (!element || !element.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext('2d')?.drawImage(element, 0, 0);
    canvas.toBlob((blob) => blob && onCapture(blob), 'image/jpeg', 0.9);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('camera_title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            {t('cancel')}
          </Button>
          <Button icon={<Ico name="camera" size={18} />} disabled={state !== 'ready'} onPress={capture}>
            {t('capture')}
          </Button>
        </>
      }>
      {state === 'denied' || state === 'unsupported' ? (
        <p className="xw-fmsg" role="alert">
          {t(state === 'denied' ? 'camera_denied' : 'camera_unsupported')}
        </p>
      ) : (
        <div className="xw-cam">
          {/* Vista previa en vivo de la cámara (sin audio): no lleva pista de subtítulos. */}
          <video ref={video} playsInline muted aria-label={t('camera_preview')} />
          {state === 'starting' ? <p className="xw-cam-wait">{t('camera_starting')}</p> : null}
        </div>
      )}
    </Modal>
  );
}
