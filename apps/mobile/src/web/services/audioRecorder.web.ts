import { useCallback, useEffect, useRef, useState } from 'react';

/** Duración máxima de una nota de voz (evita una grabación olvidada abierta indefinidamente). */
export const MAX_RECORDING_SECONDS = 120;

export type RecorderState = 'idle' | 'recording' | 'denied' | 'unsupported';

export const micSupported = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

/** El primer tipo soportado por el navegador, de más a menos preferido. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
}

export interface RecordedAudio {
  blob: Blob;
  seconds: number;
}

/**
 * Graba audio del micrófono (sección 4C): pide permiso solo al tocar "Grabar audio", cuenta los segundos mientras
 * graba y siempre apaga el micrófono al terminar (parar, cancelar, desmontar). `stop` resuelve el adjunto listo para
 * previsualizar; `cancel` descarta sin generar nada.
 */
export function useAudioRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const autoStop = useRef<(() => void) | null>(null);

  const teardown = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    chunks.current = [];
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    if (!micSupported()) return setState('unsupported');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      recorder.current = rec;
      rec.start();
      startedAt.current = Date.now();
      setSeconds(0);
      setState('recording');
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_RECORDING_SECONDS) autoStop.current?.();
      }, 250);
    } catch {
      setState('denied');
    }
  }, []);

  const stop = useCallback((): Promise<RecordedAudio | null> => {
    const rec = recorder.current;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    const finalSeconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        teardown();
        setState('idle');
        resolve({ blob, seconds: finalSeconds });
      };
      rec.stop();
    });
  }, [teardown]);
  // Se guarda en un ref (no en el cierre del setInterval de `start`, creado antes de que `stop` exista) fuera del render.
  useEffect(() => {
    autoStop.current = () => void stop();
  }, [stop]);

  const cancel = useCallback(() => {
    const rec = recorder.current;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      rec.stop();
    }
    teardown();
    setState('idle');
  }, [teardown]);

  return { state, seconds, start, stop, cancel };
}
