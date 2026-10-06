import { formatClock, formatDay, formatMoney, localDate, localTime, translate, phoneHref, upperFirst, whatsappLink, type Currency, type Language, type PublicAppointmentDto } from '@xiro/shared';
import { useState } from 'react';
import { ApiError, publicApi } from '../api';
import { errorKey, useAsync } from '../lib/useAsync';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SchedulePicker } from '../ui/SchedulePicker';
import { StarRating } from '../ui/StarRating';

const STATUS_TONE: Record<PublicAppointmentDto['status'], string> = { pending: 'warning', confirmed: 'success', in_progress: 'success', completed: 'success', cancelled: 'muted', no_show: 'danger' };

/** Ficha de la cita con el enlace personal: ver, cancelar, mover o eliminar los datos personales. Sin sesión: el token es la única llave. */
export function ManagePage({ slug, token, language }: { slug: string; token: string; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const state = useAsync(() => publicApi.appointment(slug, token), [slug, token]);
  const [appointment, setAppointment] = useState<PublicAppointmentDto>();
  const current = appointment ?? state.data;

  const [busy, setBusy] = useState<'cancel' | 'reschedule' | 'delete' | 'review' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>();
  const [alternatives, setAlternatives] = useState<Array<{ time: string; startsAt: string }>>([]);
  const [done, setDone] = useState<'cancelled' | 'deleted' | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [reviewError, setReviewError] = useState<string>();
  const [reviewSent, setReviewSent] = useState(false);

  if (state.loading) {
    return (
      <div className="xp-empty" role="status">
        <span className="xp-spinner" aria-hidden="true" />
        <p>{t('loading')}</p>
      </div>
    );
  }
  if (state.error || !current) {
    return (
      <div className="xp-empty" role="alert">
        <h1>{t('pub_manage_not_found_title')}</h1>
        <p>{t('pub_manage_not_found_text')}</p>
      </div>
    );
  }

  const currency = current.business.currency as Currency;
  const timezone = current.business.timezone;

  async function cancel() {
    setBusy('cancel');
    setActionError(undefined);
    try {
      setAppointment(await publicApi.cancel(slug, token, cancelReason.trim()));
      setConfirmCancel(false);
      setDone('cancelled');
    } catch (error) {
      setActionError(t(errorKey(error)));
    } finally {
      setBusy(null);
    }
  }

  async function saveReschedule() {
    if (!slot) return setActionError(t('pub_err_slot'));
    setBusy('reschedule');
    setActionError(undefined);
    try {
      setAppointment(await publicApi.reschedule(slug, token, slot));
      setMoving(false);
      setSlot(null);
      setAlternatives([]);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'slot_taken') {
        setAlternatives((error.extra.alternatives as Array<{ time: string; startsAt: string }> | undefined) ?? []);
        setActionError(t('slot_taken'));
      } else {
        setActionError(t(errorKey(error)));
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitReview() {
    if (rating < 1) return setReviewError(t('pub_review_err_rating'));
    setBusy('review');
    setReviewError(undefined);
    try {
      setAppointment(await publicApi.review(slug, token, rating, comment.trim()));
      setReviewSent(true);
    } catch (error) {
      setReviewError(t(errorKey(error)));
    } finally {
      setBusy(null);
    }
  }

  async function deleteData() {
    setBusy('delete');
    setActionError(undefined);
    try {
      await publicApi.deleteData(slug, token);
      setConfirmDelete(false);
      setDone('deleted');
    } catch (error) {
      setActionError(t(errorKey(error)));
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className="xp-page">
        <main className="xp-main xp-container">
          <div className="xp-section xp-stack">
            <h1>{t(done === 'cancelled' ? 'pub_manage_cancelled_title' : 'pub_manage_deleted_title')}</h1>
            {done === 'deleted' ? <p className="xp-muted">{t('pub_manage_deleted_text')}</p> : null}
          </div>
        </main>
      </div>
    );
  }

  const selection = { services: current.items.filter((i) => i.kind === 'service' && i.itemId).map((i) => ({ itemId: i.itemId!, variantId: i.variantId })), packages: current.items.filter((i) => i.kind === 'package' && i.packageId).map((i) => i.packageId!) };

  return (
    <div className="xp-page">
      <main className="xp-main xp-container">
        <div className="xp-section xp-stack">
          <h1>{t('pub_manage_title')}</h1>
          <div className="xp-row">
            <Alert tone={STATUS_TONE[current.status] === 'danger' ? 'danger' : STATUS_TONE[current.status] === 'success' ? 'success' : 'info'}>{t(`appt_status_${current.status}`)}</Alert>
          </div>
          {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

          <div className="xp-card xp-stack">
            <p>
              <strong>{upperFirst(formatDay(localDate(current.startsAt, timezone), language))}</strong>
              <br />
              {formatClock(localTime(current.startsAt, timezone), language)} – {formatClock(localTime(current.endsAt, timezone), language)}
            </p>
            <p className="xp-muted">{t('pub_manage_with', { name: current.professionalName })}</p>
            <ul className="xp-stack">
              {current.items.map((item) => (
                <li key={item.id} className="xp-summary-row">
                  <span>{item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name}</span>
                  <span>{formatMoney(item.price * item.quantity, currency)}</span>
                </li>
              ))}
            </ul>
            <div className="xp-summary-row xp-summary-total">
              <span>{t('pub_summary_total')}</span>
              <span className="xp-item-price">{formatMoney(current.totalPrice, currency)}</span>
            </div>
          </div>

          <div className="xp-card xp-stack">
            <p>{current.business.name}</p>
            {current.business.address ? (
              <p className="xp-muted">
                {current.business.address}
                {current.business.city ? `, ${current.business.city}` : ''}
              </p>
            ) : null}
            <div className="xp-btn-row">
              {current.business.whatsapp ? (
                <a className="xp-btn xp-btn--secondary xp-btn--auto" href={whatsappLink(current.business.whatsapp, '')} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              ) : null}
              {current.business.phone ? (
                <a className="xp-btn xp-btn--ghost xp-btn--auto" href={phoneHref(current.business.phone)}>
                  {t('call')}
                </a>
              ) : null}
            </div>
          </div>

          {current.canCancel || current.canReschedule ? (
            <p className="xp-hint">{t('pub_manage_changeable_until', { date: `${upperFirst(formatDay(localDate(current.changeableUntil, timezone), language))} ${formatClock(localTime(current.changeableUntil, timezone), language)}` })}</p>
          ) : (
            <p className="xp-hint">{t('pub_manage_cant_change')}</p>
          )}

          {current.canReschedule ? (
            <p className="xp-hint">{t('pub_manage_modifications_left', { count: current.modificationsLeft })}</p>
          ) : current.canCancel ? (
            <p className="xp-hint">{t('pub_manage_no_changes_left')}</p>
          ) : null}

          {moving ? (
            <div className="xp-card xp-stack">
              <SchedulePicker slug={slug} timezone={timezone} selection={selection} professionalId="any" date={date || localDate(current.startsAt, timezone)} onDate={(d) => { setDate(d); setSlot(null); }} slot={slot} onSlot={(s) => setSlot(s.startsAt)} maxDaysAhead={90} language={language} />
              {alternatives.length > 0 ? (
                <div className="xp-chips">
                  {alternatives.map((alt) => (
                    <button key={alt.startsAt} type="button" className="xp-chip" onClick={() => { setDate(alt.startsAt.slice(0, 10)); setSlot(alt.startsAt); setAlternatives([]); }}>
                      {alt.time}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="xp-btn-row">
                <Button loading={busy === 'reschedule'} onClick={() => void saveReschedule()}>
                  {t('pub_manage_reschedule_save')}
                </Button>
                <Button variant="ghost" full={false} onClick={() => setMoving(false)}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="xp-btn-row">
              {current.canReschedule ? (
                <Button variant="secondary" full={false} onClick={() => setMoving(true)}>
                  {t('pub_manage_reschedule_cta')}
                </Button>
              ) : null}
              {current.canCancel ? (
                <Button variant="danger" full={false} onClick={() => setConfirmCancel(true)}>
                  {t('pub_manage_cancel_cta')}
                </Button>
              ) : null}
            </div>
          )}

          {current.canReview ? (
            <section className="xp-card xp-stack" aria-labelledby="xp-review-h">
              {reviewSent ? (
                <>
                  <h2 id="xp-review-h">{t('pub_review_sent_title')}</h2>
                  <p className="xp-muted">{t('pub_review_sent_text')}</p>
                </>
              ) : (
                <>
                  <h2 id="xp-review-h">{t('pub_review_title')}</h2>
                  <p className="xp-hint">{t('pub_review_hint')}</p>
                  <StarRating value={rating} onChange={setRating} label={t('pub_review_rating')} starLabel={(n) => t('reviews_stars', { count: n })} />
                  {reviewError ? <Alert tone="danger">{reviewError}</Alert> : null}
                  <label className="xp-field">
                    <span className="xp-label">{t('pub_review_comment')}</span>
                    <textarea className="xp-textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
                  </label>
                  <Button full={false} loading={busy === 'review'} onClick={() => void submitReview()}>
                    {t('pub_review_submit')}
                  </Button>
                </>
              )}
            </section>
          ) : null}

          <Button variant="ghost" full={false} onClick={() => setConfirmDelete(true)}>
            {t('pub_manage_delete_cta')}
          </Button>
        </div>
      </main>

      {confirmCancel ? (
        <Modal
          title={t('pub_manage_cancel_confirm_title')}
          onClose={() => setConfirmCancel(false)}
          footer={
            <>
              <Button variant="ghost" full={false} onClick={() => setConfirmCancel(false)} disabled={busy === 'cancel'}>
                {t('back')}
              </Button>
              <Button variant="danger" full={false} loading={busy === 'cancel'} onClick={() => void cancel()}>
                {t('pub_manage_cancel_cta')}
              </Button>
            </>
          }>
          <p>{t('pub_manage_cancel_confirm_text')}</p>
          <label className="xp-field">
            <span className="xp-label">{t('pub_manage_cancel_reason')}</span>
            <textarea className="xp-textarea" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={200} />
          </label>
        </Modal>
      ) : null}

      {confirmDelete ? (
        <Modal
          title={t('pub_manage_delete_confirm_title')}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="ghost" full={false} onClick={() => setConfirmDelete(false)} disabled={busy === 'delete'}>
                {t('back')}
              </Button>
              <Button variant="danger" full={false} loading={busy === 'delete'} onClick={() => void deleteData()}>
                {t('pub_manage_delete_cta')}
              </Button>
            </>
          }>
          <p>{t('pub_manage_delete_confirm_text')}</p>
        </Modal>
      ) : null}
    </div>
  );
}
