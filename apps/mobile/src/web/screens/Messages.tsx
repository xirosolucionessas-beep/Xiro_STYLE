import type { ConversationDto, MessageDto, MessagePerson } from '@xiro/shared';
import { useEffect, useRef, useState } from 'react';
import { Ico } from '../icons';
import { resolveMedia } from '../media';
import { Avatar, EmptyPanel, LoadingRows } from '../ui/Page';
import { cx, useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface MessagesViewProps {
  t: T;
  meId: string;
  people: MessagePerson[];
  peopleLoading: boolean;
  conversations: ConversationDto[];
  conversationsLoading: boolean;
  /** Fila por conversación, ya con "hace 10 min" resuelto (el formateador vive en el contenedor, que conoce el idioma). */
  timeOf: (iso: string) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
  onStart: (userId: string) => void;
  thread: MessageDto[];
  threadLoading: boolean;
  threadError: boolean;
  onSend: (content: string) => void;
  sending: boolean;
  sendError?: string;
}

function avatarOf(name: string, photoUrl: string | null) {
  // resolveMedia: el servidor devuelve una ruta relativa ("/media/xxx.webp") que hay que anclar al origen de la API,
  // no al de la página (son distintos en el servidor de desarrollo de Expo) — mismo motivo que el resto de las fotos.
  const resolved = resolveMedia(photoUrl);
  if (!resolved) return <Avatar name={name} />;
  return (
    <span className="xw-avatar" aria-hidden="true">
      <img src={resolved} alt="" className="xw-avatar-img" />
    </span>
  );
}

/** Chat interno del equipo: lista de conversaciones a la izquierda, hilo abierto a la derecha (en angosto, una vista a la vez). */
export function MessagesView(props: MessagesViewProps) {
  useWebStyles();
  const { t, meId, people, peopleLoading, conversations, conversationsLoading, timeOf, selectedId, onSelect, onBack, onStart, thread, threadLoading, threadError, onSend, sending, sendError } = props;
  const [composerOpen, setComposerOpen] = useState(false);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const peopleWithoutChat = people.filter((p) => !conversations.some((c) => c.peer.id === p.id));

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [thread.length, selectedId]);

  function submit() {
    const content = text.trim();
    if (!content || sending) return;
    onSend(content);
    setText('');
  }

  return (
    <div className={cx('xw-msg', selectedId && 'has-selection')}>
      <div className="xw-msg-list">
        <div className="xw-msg-list-head">
          <h2 className="xw-msg-list-title">{t('msg_list_title')}</h2>
          <button type="button" className="xw-icon-btn" aria-label={t('msg_new')} aria-expanded={composerOpen} onClick={() => setComposerOpen((v) => !v)}>
            <Ico name="plus" size={20} />
          </button>
        </div>

        {composerOpen ? (
          <div className="xw-msg-people">
            <p className="xw-hint">{t('msg_pick_person')}</p>
            {peopleLoading ? <LoadingRows label={t('dash_loading')} rows={2} /> : null}
            {!peopleLoading && people.length === 0 ? <p className="xw-panel-empty">{t('msg_no_people')}</p> : null}
            {peopleWithoutChat.map((p) => (
              <button
                key={p.id}
                type="button"
                className="xw-msg-row"
                onClick={() => {
                  onStart(p.id);
                  setComposerOpen(false);
                }}>
                {avatarOf(p.name, p.photoUrl)}
                <span className="xw-notif-text">
                  <span className="xw-notif-title">{p.name}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {conversationsLoading ? <LoadingRows label={t('dash_loading')} /> : null}
        {!conversationsLoading && conversations.length === 0 && !composerOpen ? (
          <EmptyPanel icon="message-circle" title={t('msg_list_empty_title')} text={t('msg_list_empty_text')} />
        ) : null}
        <ul className="xw-msg-conv-list">
          {conversations.map((c) => (
            <li key={c.id}>
              <button type="button" className={cx('xw-msg-row', c.id === selectedId && 'is-active')} data-unread={c.unreadCount > 0} onClick={() => onSelect(c.id)}>
                {avatarOf(c.peer.name, c.peer.photoUrl)}
                <span className="xw-notif-text">
                  <span className="xw-notif-title">{c.peer.name}</span>
                  <span className="xw-notif-detail">{c.lastMessage ? (c.lastMessage.senderId === meId ? t('msg_you_prefix', { text: c.lastMessage.content }) : c.lastMessage.content) : ''}</span>
                </span>
                <span className="xw-msg-row-meta">
                  <span className="xw-notif-time">{timeOf(c.updatedAt)}</span>
                  {c.unreadCount > 0 ? (
                    <span className="xw-msg-badge" aria-label={t('msg_unread_label', { n: c.unreadCount })}>
                      {c.unreadCount > 9 ? '9+' : c.unreadCount}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="xw-msg-thread">
        {!selected ? (
          <div className="xw-msg-thread-empty">
            <Ico name="message-square" size={40} />
            <p>{t('msg_thread_empty')}</p>
          </div>
        ) : (
          <>
            <div className="xw-msg-thread-head">
              <button type="button" className="xw-icon-btn xw-msg-back" aria-label={t('msg_back_to_list')} onClick={onBack}>
                <Ico name="arrow-left" size={20} />
              </button>
              {avatarOf(selected.peer.name, selected.peer.photoUrl)}
              <span className="xw-notif-title">{selected.peer.name}</span>
            </div>
            <ul className="xw-msg-bubbles" ref={listRef}>
              {threadLoading ? <LoadingRows label={t('dash_loading')} rows={2} /> : null}
              {threadError ? <p className="xw-panel-empty">{t('msg_load_error')}</p> : null}
              {thread.map((m) => (
                <li key={m.id} className={cx('xw-bubble', m.senderId === meId ? 'is-mine' : 'is-theirs')}>
                  <span className="xw-bubble-text">{m.content}</span>
                  <span className="xw-bubble-time">{timeOf(m.createdAt)}</span>
                </li>
              ))}
            </ul>
            <form
              className="xw-msg-compose"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}>
              <input className="xw-msg-input" value={text} onChange={(event) => setText(event.target.value)} placeholder={t('msg_input_placeholder')} maxLength={4000} aria-label={t('msg_input_placeholder')} />
              <button type="submit" className="xw-icon-btn xw-msg-send" aria-label={t('msg_send_aria')} disabled={!text.trim() || sending}>
                <Ico name="send" size={18} />
              </button>
            </form>
            {sendError ? (
              <p className="xw-error" role="alert">
                {sendError}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
