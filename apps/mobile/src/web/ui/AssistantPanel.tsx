import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Ico } from '../icons';
import { formatCountdown } from '../otp';
import { askAssistant, type AssistantAskResult, type AssistantAttachmentInput, type AssistantRequest } from '../services/assistant.web';
import { useAudioRecorder } from '../services/audioRecorder.web';
import { Button } from './Button';
import { validatePhotoFile } from './PhotoPicker';
import { cx, useWebStyles } from './shared';
import { useDialogBehavior } from './useDialogBehavior';
import { prefersDeviceCamera, webcamSupported, WebcamModal } from './WebcamModal';

type T = (key: string) => string;

interface Attachment {
  id: string;
  kind: 'image' | 'audio';
  url: string;
  name: string;
  blob: Blob;
}
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: Attachment[];
}

export interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  t: T;
  /** Inyectable en pruebas; por defecto el servicio real (sin backend, responde "no disponible" — ver assistant.web.ts). */
  ask?: (request: AssistantRequest) => Promise<AssistantAskResult>;
}

const uid = () => Math.random().toString(36).slice(2);

/**
 * Panel del asistente de negocio (sección 4C): hoja inferior en móvil, panel flotante anclado en escritorio.
 * Se mantiene SIEMPRE montado (solo se oculta con CSS) para que el borrador y el historial sobrevivan a cerrarlo:
 * "el historial vive en memoria de la sesión" y "cierre del panel sin perder el borrador".
 */
export function AssistantPanel({ open, onClose, t, ask = askAssistant }: AssistantPanelProps) {
  useWebStyles();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const deviceCamera = useRef<HTMLInputElement>(null);
  const attachmentUrls = useRef(new Set<string>());
  useDialogBehavior(open, panel, onClose);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draftText, setDraftText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const lastRequest = useRef<{ text: string; attachments: Attachment[]; input: AssistantAttachmentInput[] } | null>(null);
  const recorder = useAudioRecorder();

  // Revoca las URLs locales solo cuando la app se cierra de verdad (recarga), no en cada cierre del panel: el
  // borrador y sus adjuntos deben seguir siendo válidos si el usuario vuelve a abrirlo.
  useEffect(() => {
    const urls = attachmentUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`; // ~4 líneas
  }, [draftText, open]);

  useEffect(() => {
    if (!open) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing, open]);

  const addAttachment = (kind: Attachment['kind'], blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    attachmentUrls.current.add(url);
    setAttachError(null);
    setAttachments((current) => [...current, { id: uid(), kind, url, name, blob }]);
  };
  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const found = current.find((a) => a.id === id);
      if (found) {
        URL.revokeObjectURL(found.url);
        attachmentUrls.current.delete(found.url);
      }
      return current.filter((a) => a.id !== id);
    });
  };

  /* ---------- Imagen ---------- */
  const onImageFile = (file: File | undefined) => {
    if (!file) return;
    const problem = validatePhotoFile(file);
    if (problem) return setAttachError(t(problem));
    addAttachment('image', file, file.name);
  };
  const openCamera = () => {
    if (prefersDeviceCamera() || !webcamSupported()) deviceCamera.current?.click();
    else setCameraOpen(true);
  };

  /* ---------- Audio ---------- */
  const stopAndAttach = async () => {
    const recorded = await recorder.stop();
    if (recorded) addAttachment('audio', recorded.blob, t('assistant_audio_attachment'));
  };

  /* ---------- Envío ---------- */
  const canSend = !sending && recorder.state !== 'recording' && (draftText.trim() !== '' || attachments.length > 0);

  async function runAsk(text: string, attachmentsInput: AssistantAttachmentInput[], sentAttachments: Attachment[]) {
    setSending(true);
    setTyping(true);
    setSendError(null);
    try {
      const result = await ask({ text, attachments: attachmentsInput });
      if (result.ok) {
        setMessages((current) => [...current, { id: uid(), role: 'assistant', text: result.reply }]);
        setAnnouncement(result.reply);
      } else if (result.reason === 'unavailable') {
        setMessages((current) => [...current, { id: uid(), role: 'assistant', text: t('assistant_unavailable') }]);
        setAnnouncement(t('assistant_unavailable'));
      } else {
        lastRequest.current = { text, attachments: sentAttachments, input: attachmentsInput };
        setSendError(t('assistant_error_general'));
      }
    } catch {
      lastRequest.current = { text, attachments: sentAttachments, input: attachmentsInput };
      setSendError(t('assistant_error_general'));
    } finally {
      setSending(false);
      setTyping(false);
    }
  }

  async function submit() {
    if (!canSend) return;
    const text = draftText.trim();
    const sentAttachments = attachments;
    const input: AssistantAttachmentInput[] = sentAttachments.map((a) => ({ kind: a.kind, name: a.name, blob: a.blob }));
    setMessages((current) => [...current, { id: uid(), role: 'user', text, attachments: sentAttachments.length ? sentAttachments : undefined }]);
    setDraftText('');
    setAttachments([]);
    setAttachError(null);
    await runAsk(text, input, sentAttachments);
  }
  const retry = () => {
    const pending = lastRequest.current;
    if (pending) void runAsk(pending.text, pending.input, pending.attachments);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <>
      {createPortal(
        <div role="presentation" data-xw-portal="" className={cx('xw-asst-root', !open && 'is-closed')}>
          <div role="presentation" className="xw-asst-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()} />
          <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="xw-asst-panel">
            <header className="xw-asst-head">
              <span className="xw-asst-head-ic" aria-hidden="true">
                <Ico name="bot" size={22} />
              </span>
              <div className="xw-asst-head-text">
                <h2 id={titleId} className="xw-asst-head-title">
                  {t('assistant_title')}
                </h2>
                <p className="xw-asst-head-sub">{t('assistant_subtitle')}</p>
              </div>
              <button type="button" className="xw-asst-head-close" aria-label={t('assistant_close')} onClick={onClose}>
                <Ico name="x" size={18} />
              </button>
            </header>

            {/* tabIndex: región con scroll propio (panel más compacto) — debe ser alcanzable por teclado para desplazarla (axe scrollable-region-focusable). */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            <div className="xw-asst-body" ref={scroller} tabIndex={0}>
              <div className="xw-asst-msg is-bot">
                <p>{t('assistant_welcome')}</p>
              </div>
              {messages.map((message) => (
                <div key={message.id} className={cx('xw-asst-msg', message.role === 'user' ? 'is-user' : 'is-bot')}>
                  {message.attachments?.map((attachment) =>
                    attachment.kind === 'image' ? (
                      <img key={attachment.id} className="xw-asst-msg-img" src={attachment.url} alt={t('assistant_image_attachment')} />
                    ) : (
                      // eslint-disable-next-line jsx-a11y/media-has-caption -- nota de voz sin diálogo hablado que subtitular
                      <audio key={attachment.id} className="xw-asst-msg-audio" controls src={attachment.url} />
                    ),
                  )}
                  {message.text ? <p>{message.text}</p> : null}
                </div>
              ))}
              {typing ? (
                <div className="xw-asst-msg is-bot xw-asst-typing" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
            </div>
            <div className="xw-sr" role="status" aria-live="polite">
              {typing ? t('assistant_typing') : announcement}
            </div>

            {sendError ? (
              <div className="xw-asst-error" role="alert">
                <span>{sendError}</span>
                <button type="button" className="xw-link-btn" onClick={retry}>
                  {t('assistant_retry')}
                </button>
              </div>
            ) : null}

            <div className="xw-asst-input">
              {attachments.length > 0 ? (
                <div className="xw-asst-attachments">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="xw-asst-attachment">
                      {attachment.kind === 'image' ? (
                        <img src={attachment.url} alt="" />
                      ) : (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <audio controls src={attachment.url} />
                      )}
                      <button type="button" className="xw-asst-attachment-remove" aria-label={`${t('assistant_remove_attachment')}: ${attachment.name}`} onClick={() => removeAttachment(attachment.id)}>
                        <Ico name="x" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {attachError ? (
                <p className="xw-error" role="alert">
                  {attachError}
                </p>
              ) : null}

              {recorder.state === 'recording' ? (
                <div className="xw-asst-recording">
                  <span className="xw-asst-rec-dot" aria-hidden="true" />
                  <span className="xw-asst-rec-label">{t('assistant_recording')}</span>
                  <span className="xw-asst-rec-time" aria-hidden="true">
                    {formatCountdown(recorder.seconds)}
                  </span>
                  <div className="xw-asst-rec-actions">
                    <Button variant="ghost" size="sm" onPress={recorder.cancel}>
                      {t('assistant_recording_cancel')}
                    </Button>
                    <Button size="sm" onPress={() => void stopAndAttach()}>
                      {t('assistant_recording_stop')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="xw-asst-row1">
                    <textarea
                      ref={textarea}
                      className="xw-asst-textarea"
                      aria-label={t('assistant_input_label')}
                      placeholder={t('assistant_placeholder')}
                      value={draftText}
                      rows={1}
                      onChange={(event) => setDraftText(event.target.value)}
                      onKeyDown={onKeyDown}
                    />
                    <button type="button" className="xw-asst-sqbtn" aria-label={t('assistant_attach_image')} title={t('assistant_attach_image')} onClick={() => fileInput.current?.click()}>
                      <Ico name="image" size={18} />
                    </button>
                    <button type="button" className="xw-asst-sqbtn" aria-label={t('assistant_take_photo')} title={t('assistant_take_photo')} onClick={openCamera}>
                      <Ico name="camera" size={18} />
                    </button>
                  </div>
                  {recorder.state === 'denied' ? (
                    <p className="xw-error" role="alert">
                      {t('assistant_mic_denied')}
                    </p>
                  ) : recorder.state === 'unsupported' ? (
                    <p className="xw-error" role="alert">
                      {t('assistant_mic_unsupported')}
                    </p>
                  ) : null}
                  <div className="xw-asst-row2">
                    <button type="button" className="xw-asst-mic" aria-label={t('assistant_record')} title={t('assistant_record')} onClick={() => void recorder.start()}>
                      <Ico name="mic" size={20} />
                    </button>
                    <button type="button" className="xw-asst-send" aria-label={t('assistant_send')} title={t('assistant_send')} disabled={!canSend} onClick={() => void submit()}>
                      <Ico name="send" size={18} />
                    </button>
                  </div>
                </>
              )}
            </div>
            <p className="xw-asst-footer">{t('assistant_footer')}</p>
          </div>
        </div>,
        document.body,
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="xw-sr"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          onImageFile(file);
        }}
      />
      <input
        ref={deviceCamera}
        type="file"
        accept="image/*"
        capture="environment"
        className="xw-sr"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          onImageFile(file);
        }}
      />
      <WebcamModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        t={t}
        onCapture={(blob) => {
          setCameraOpen(false);
          addAttachment('image', blob, 'photo.jpg');
        }}
      />
    </>
  );
}
