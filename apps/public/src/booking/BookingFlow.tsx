import {
  formatClock,
  formatDay,
  isValidPhone,
  localDate,
  localTime,
  looksLikeEmail,
  publicBookingInputSchema,
  publicProductOrderInputSchema,
  todayIn,
  translate,
  type BookingSelection,
  type ClientAccountDto,
  type Language,
  type PublicBookingCatalog,
  type PublicBookingProfile,
  type PublicBookingResult,
  type PublicProductOrderDto,
  type PublicTeamMemberDto,
} from '@xiro/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, publicApi } from '../api';
import { errorKey } from '../lib/useAsync';
import { newUuid } from '../lib/uuid';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { SchedulePicker } from '../ui/SchedulePicker';
import { DoneStep } from './DoneStep';
import { OrderDoneStep } from './OrderDoneStep';
import { SelectionBar, type SelectionSummary } from './SelectionBar';
import { Stepper, type StepId } from './Stepper';
import { DetailsStep, ProfessionalStep, ReviewStep, ServicesStep, type CustomerForm } from './steps';

export interface Chosen {
  services: Array<{ itemId: string; variantId: string | null }>;
  packages: string[];
  products: Array<{ itemId: string; quantity: number }>;
}

/** Lo que se eligió en la página antes de abrir el flujo (el botón "Reservar" de un servicio, paquete o producto). */
export interface InitialChoice {
  serviceId?: string;
  packageId?: string;
  productId?: string;
}

const selectionOf = (chosen: Chosen): Pick<BookingSelection, 'services' | 'packages'> => ({ services: chosen.services, packages: chosen.packages });

/**
 * Con sesión, el paso "Tus datos" viene prellenado con los de la cuenta — editable para ESTA cita, sin que eso la
 * cambie (ver sección 8.9 del encargo). `ClientAccountDto` solo guarda un nombre completo, no nombre/apellido
 * aparte: se reparte en la primera palabra y el resto, igual que hace cualquier formulario con ese mismo dato.
 */
function customerFromAccount(account: ClientAccountDto | null | undefined): CustomerForm {
  if (!account) return { firstName: '', lastName: '', phone: '', email: '', notes: '' };
  const [firstName = '', ...rest] = account.name.trim().split(/\s+/);
  // El teléfono se guarda normalizado (p. ej. "573001234567"); con el indicativo de Colombia se muestra en su forma
  // local de 10 dígitos, que es la que la persona reconoce y puede corregir sin confundirse con el indicativo.
  const phone = account.phone.startsWith('57') && account.phone.length === 12 ? account.phone.slice(2) : account.phone;
  return { firstName, lastName: rest.join(' '), phone, email: account.email ?? '', notes: '' };
}

/**
 * Flujo de reserva sin cuenta, en pasos cortos: Servicio → Profesional (solo si hay equipo visible) → Fecha y hora → Tus datos →
 * Resumen. Con progreso nombrado, la selección siempre a la vista, "Atrás" sin perder nada y cada paso enfocado al abrirse para
 * lectores de pantalla. Confirmar es idempotente: doble clic o un reintento devuelven la misma cita.
 */
export function BookingFlow({
  slug,
  profile,
  catalog,
  catalogLoading = false,
  team,
  language,
  initial = {},
  account,
  onClose,
}: {
  slug: string;
  profile: PublicBookingProfile;
  catalog: PublicBookingCatalog;
  catalogLoading?: boolean;
  team: PublicTeamMemberDto[];
  language: Language;
  initial?: InitialChoice;
  /** Con sesión, el formulario viene con sus datos (editables para esta cita, sin que eso cambie la cuenta). */
  account?: ClientAccountDto | null;
  onClose: () => void;
}) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [chosen, setChosen] = useState<Chosen>(() => ({
    services: initial.serviceId ? [{ itemId: initial.serviceId, variantId: null }] : [],
    packages: initial.packageId ? [initial.packageId] : [],
    products: initial.productId ? [{ itemId: initial.productId, quantity: 1 }] : [],
  }));
  // Pedido de SOLO productos (el negocio lo activó y no se eligió ningún servicio ni paquete): no hay profesional ni horario,
  // así que esos pasos se omiten. En cuanto se agrega un servicio vuelve a ser una cita, con todos sus pasos y sin perder nada.
  const hasBookable = chosen.services.length + chosen.packages.length > 0;
  const orderMode = profile.acceptsProductOrders && !hasBookable && chosen.products.length > 0;
  const steps: StepId[] = useMemo(
    () => (orderMode ? ['services', 'details', 'review'] : ['services', ...(team.length > 0 ? (['professional'] as const) : []), 'schedule', 'details', 'review']),
    [orderMode, team.length],
  );
  const [stepIndex, setStepIndex] = useState(0);
  // La selección solo cambia en el primer paso, pero por si acaso el índice nunca queda fuera de los pasos vigentes.
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const [professionalId, setProfessionalId] = useState('any');
  const [date, setDate] = useState(() => todayIn(profile.timezone));
  const [slot, setSlot] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string>();
  const [alternatives, setAlternatives] = useState<Array<{ time: string; startsAt: string }>>([]);

  const [customer, setCustomer] = useState<CustomerForm>(() => customerFromAccount(account));
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState({ acceptTerms: false, remindersOptIn: false });
  const [website, setWebsite] = useState(''); // campo trampa
  const [captchaToken, setCaptchaToken] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublicBookingResult>();
  const [orderResult, setOrderResult] = useState<PublicProductOrderDto>();
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // La clave de idempotencia identifica ESTE intento de confirmar: cambia si se cambia lo elegido (otro horario u otro servicio es
  // otra reserva), pero no entre un clic y su reintento. Así un doble clic o un reintento por mala señal devuelven la misma cita,
  // y nunca se le devuelve a alguien una cita distinta de la que acaba de elegir.
  const choiceSignature = JSON.stringify([chosen, professionalId, slot]);
  const idempotencyKey = useMemo(() => newUuid(), [choiceSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar de paso: foco en su título (los lectores de pantalla lo anuncian) y de vuelta arriba.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    body.current?.scrollTo({ top: 0 });
  }, [step]);

  // El fondo no se desplaza mientras el flujo está abierto; Esc cierra.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const totals = useMemo(() => {
    let price = 0;
    let minutes = 0;
    for (const s of chosen.services) {
      const item = catalog.services.find((i) => i.id === s.itemId);
      const variant = s.variantId ? item?.variants.find((v) => v.id === s.variantId) : undefined;
      price += variant?.price ?? item?.price ?? 0;
      minutes += variant?.durationMinutes ?? item?.durationMinutes ?? 0;
    }
    for (const id of chosen.packages) {
      const pkg = catalog.packages.find((p) => p.id === id);
      price += pkg?.price ?? 0;
      minutes += pkg?.durationMinutes ?? 0;
    }
    for (const p of chosen.products) price += (catalog.products.find((i) => i.id === p.itemId)?.price ?? 0) * p.quantity;
    return { price, minutes };
  }, [chosen, catalog]);

  // Se puede seguir con un servicio o paquete (cita), o solo con productos si el negocio acepta pedidos.
  const hasSelection = hasBookable || orderMode;
  const professionalName = professionalId === 'any' ? t('pub_sel_professional_any') : (team.find((m) => m.id === professionalId)?.name ?? '');
  const slotLabel = slot ? `${formatDay(localDate(slot, profile.timezone), language, { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatClock(localTime(slot, profile.timezone), language)}` : null;

  const summary: SelectionSummary = {
    names: [
      ...chosen.services.map((s) => catalog.services.find((i) => i.id === s.itemId)?.name ?? ''),
      ...chosen.packages.map((id) => catalog.packages.find((p) => p.id === id)?.name ?? ''),
      // Los productos también cuentan como "elegido": antes la barra decía "Aún no has elegido nada" con productos marcados.
      ...chosen.products.map((p) => {
        const name = catalog.products.find((i) => i.id === p.itemId)?.name ?? '';
        return name && p.quantity > 1 ? `${name} ×${p.quantity}` : name;
      }),
    ].filter(Boolean),
    professional: !orderMode && stepIndex > steps.indexOf('professional') && team.length > 0 ? professionalName : null,
    when: slotLabel,
    minutes: totals.minutes,
    price: totals.price,
    currency: profile.currency,
  };

  function toggleService(itemId: string, on: boolean) {
    setSlot(null);
    setChosen((c) => (on ? { ...c, services: [...c.services, { itemId, variantId: null }] } : { ...c, services: c.services.filter((s) => s.itemId !== itemId) }));
  }
  function setVariant(itemId: string, variantId: string | null) {
    setSlot(null);
    setChosen((c) => ({ ...c, services: c.services.map((s) => (s.itemId === itemId ? { ...s, variantId } : s)) }));
  }
  function togglePackage(id: string, on: boolean) {
    setSlot(null);
    setChosen((c) => (on ? { ...c, packages: [...c.packages, id] } : { ...c, packages: c.packages.filter((p) => p !== id) }));
  }
  function setProductQty(itemId: string, quantity: number) {
    setChosen((c) => {
      const rest = c.products.filter((p) => p.itemId !== itemId);
      return { ...c, products: quantity > 0 ? [...rest, { itemId, quantity }] : rest };
    });
  }

  function validateDetails(): boolean {
    const found: Record<string, string> = {};
    if (!customer.firstName.trim()) found.firstName = t('required');
    if (!customer.lastName.trim()) found.lastName = t('required');
    if (!isValidPhone(customer.phone)) found.phone = t('phone_invalid');
    // El correo es siempre opcional al agendar (solo nombre y celular son obligatorios); si se escribe uno, debe
    // tener forma de correo válida.
    if (customer.email.trim() && !looksLikeEmail(customer.email.trim())) found.email = t('email_invalid');
    for (const field of profile.rules.customFields) if (field.required && !(custom[field.key] ?? '').trim()) found[`custom.${field.key}`] = t('required');
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  function goNext() {
    setStepError(undefined);
    setSubmitError(undefined);
    if (step === 'services' && !hasSelection) {
      // Solo productos en un negocio que no recibe pedidos: los productos van como complemento de una cita.
      if (chosen.products.length > 0 && !profile.acceptsProductOrders) return setStepError(t('pub_err_products_need_service'));
      return setStepError(t(profile.acceptsProductOrders ? 'pub_err_selection_any' : 'pub_err_selection'));
    }
    if (step === 'schedule' && !slot) return setStepError(t('pub_err_slot'));
    if (step === 'details' && !validateDetails()) return setStepError(t('pub_err_fix'));
    setAlternatives([]);
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }
  function goBack() {
    setStepError(undefined);
    if (stepIndex === 0) return onClose();
    setStepIndex((i) => i - 1);
  }

  async function submit() {
    setSubmitError(undefined);
    if (!consent.acceptTerms) return setErrors({ acceptTerms: t('terms_required') });
    setErrors({});
    if (orderMode) return submitOrder();
    const payload = {
      selection: { services: chosen.services, packages: chosen.packages, products: chosen.products },
      professionalId,
      startsAt: slot!,
      customer: { firstName: customer.firstName.trim(), lastName: customer.lastName.trim(), phone: customer.phone.trim(), email: customer.email.trim() || undefined, notes: customer.notes.trim(), custom },
      acceptTerms: true as const,
      remindersOptIn: consent.remindersOptIn,
      website,
      captchaToken,
      idempotencyKey,
    };
    const parsed = publicBookingInputSchema.safeParse(payload);
    if (!parsed.success) return setSubmitError(t('pub_err_fix'));

    setSubmitting(true);
    try {
      setResult(await publicApi.book(slug, parsed.data));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'slot_taken') {
        // Otra persona tomó el horario primero: se vuelve a "Fecha y hora" (que recarga los horarios) con alternativas cercanas.
        setAlternatives((error.extra.alternatives as Array<{ time: string; startsAt: string }> | undefined) ?? []);
        setSlot(null);
        setStepIndex(steps.indexOf('schedule'));
        setStepError(t('pub_slot_taken'));
      } else {
        setSubmitError(t(errorKey(error)));
      }
    } finally {
      setSubmitting(false);
    }
  }

  /** Pedido de solo productos: mismo formulario y mismas garantías (idempotente, campo trampa, captcha); el servidor pone precios. */
  async function submitOrder() {
    const payload = {
      products: chosen.products,
      customer: { firstName: customer.firstName.trim(), lastName: customer.lastName.trim(), phone: customer.phone.trim(), email: customer.email.trim() || undefined, notes: customer.notes.trim(), custom: {} },
      acceptTerms: true as const,
      website,
      captchaToken,
      idempotencyKey,
    };
    const parsed = publicProductOrderInputSchema.safeParse(payload);
    if (!parsed.success) return setSubmitError(t('pub_err_fix'));
    setSubmitting(true);
    try {
      setOrderResult((await publicApi.order(slug, parsed.data)).order);
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'out_of_stock' || error.code === 'product_unavailable')) {
        // Se agotó o se retiró algo mientras elegía: de vuelta a la selección, diciendo QUÉ, para quitarlo o cambiar la cantidad.
        const ids = (error.extra.itemIds as string[] | undefined) ?? [];
        const names = ids.map((id) => catalog.products.find((p) => p.id === id)?.name).filter(Boolean).join(', ');
        setStepIndex(0);
        setStepError(names ? t('pub_order_unavailable', { names }) : t(error.code));
      } else {
        setSubmitError(t(errorKey(error)));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (orderResult) return <OrderDoneStep order={orderResult} profile={profile} language={language} customer={{ name: `${customer.firstName.trim()} ${customer.lastName.trim()}`.trim(), phone: customer.phone.trim() }} onClose={onClose} />;
  if (result) return <DoneStep result={result} profile={profile} language={language} customerName={customer.firstName.trim()} onClose={onClose} />;

  const isLast = step === 'review';
  const title = t(`pub_step_${step}`);
  const flowTitle = t(orderMode ? 'pub_order_flow_title' : 'pub_flow_title');

  return (
    <div className="xp-overlay" role="dialog" aria-modal="true" aria-label={flowTitle}>
      <div className="xp-overlay-head">
        <button type="button" className="xp-icon-btn" aria-label={t('close')} onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
        <div className="xp-overlay-title">
          <strong>{flowTitle}</strong>
          <span className="xp-muted">{profile.name}</span>
        </div>
      </div>
      <div className="xp-overlay-top">
        <div className="xp-container">
          <Stepper steps={steps} current={stepIndex} language={language} onGo={(index) => setStepIndex(index)} />
        </div>
      </div>

      <div className="xp-overlay-body" ref={body}>
        <h2 className="xp-step-title" ref={heading} tabIndex={-1}>
          {step === 'schedule' ? t('pub_schedule_step_title') : step === 'professional' ? t('pub_professional_step_title') : step === 'services' ? t('pub_services_step_title') : step === 'details' ? t('pub_confirm_step_title') : t(orderMode ? 'pub_order_summary_title' : 'pub_summary_title')}
          <span className="xp-sr"> — {title}</span>
        </h2>
        {stepError ? (
          <Alert tone="danger">{stepError}</Alert>
        ) : null}
        {alternatives.length > 0 && step === 'schedule' ? (
          <Alert tone="info">
            <p>{t('pub_alternatives_title')}</p>
            <div className="xp-chips">
              {alternatives.map((alt) => (
                <button
                  key={alt.startsAt}
                  type="button"
                  className="xp-chip"
                  onClick={() => {
                    setDate(localDate(alt.startsAt, profile.timezone));
                    setSlot(alt.startsAt);
                    setAlternatives([]);
                  }}>
                  {alt.time}
                </button>
              ))}
            </div>
          </Alert>
        ) : null}

        {step === 'services' ? (
          <ServicesStep
            catalog={catalog}
            loading={catalogLoading}
            chosen={chosen}
            currency={profile.currency}
            t={t}
            acceptsProductOrders={profile.acceptsProductOrders}
            orderMode={orderMode}
            onToggleService={toggleService}
            onSetVariant={setVariant}
            onTogglePackage={togglePackage}
            onSetProductQty={setProductQty}
          />
        ) : null}

        {step === 'professional' ? (
          <ProfessionalStep
            team={team}
            value={professionalId}
            t={t}
            onChange={(id) => {
              setProfessionalId(id);
              setSlot(null);
            }}
          />
        ) : null}

        {step === 'schedule' ? (
          <SchedulePicker
            slug={slug}
            timezone={profile.timezone}
            selection={selectionOf(chosen)}
            professionalId={professionalId}
            date={date}
            onDate={(d) => {
              setDate(d);
              setSlot(null);
            }}
            slot={slot}
            onSlot={(s) => setSlot(s.startsAt)}
            maxDaysAhead={profile.rules.maxDaysAhead}
            language={language}
          />
        ) : null}

        {step === 'details' ? <DetailsStep profile={profile} customer={customer} custom={custom} errors={errors} t={t} onCustomer={(patch) => setCustomer((c) => ({ ...c, ...patch }))} onCustom={(key, value) => setCustom((c) => ({ ...c, [key]: value }))} /> : null}

        {step === 'review' && (slot || orderMode) ? (
          <ReviewStep
            orderMode={orderMode}
            profile={profile}
            catalog={catalog}
            chosen={chosen}
            professionalName={professionalName}
            slot={slot}
            customer={customer}
            totals={totals}
            language={language}
            t={t}
            consent={consent}
            errors={errors}
            submitError={submitError}
            onConsent={(patch) => setConsent((c) => ({ ...c, ...patch }))}
            website={website}
            onWebsite={setWebsite}
            onCaptcha={setCaptchaToken}
          />
        ) : null}
      </div>

      <div className="xp-overlay-foot">
        <div className="xp-container">
          <SelectionBar summary={summary} language={language} />
        </div>
        <div className="xp-container xp-btn-row xp-foot-row">
          <Button variant="ghost" full={false} onClick={goBack}>
            <Icon name="back" size={18} /> {t('back')}
          </Button>
          {isLast ? (
            <Button loading={submitting} loadingLabel={t('loading')} onClick={() => void submit()}>
              {t(orderMode ? 'pub_order_submit_cta' : 'pub_submit_cta')}
            </Button>
          ) : (
            <Button onClick={goNext} disabled={catalogLoading}>
              {t('continue')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
