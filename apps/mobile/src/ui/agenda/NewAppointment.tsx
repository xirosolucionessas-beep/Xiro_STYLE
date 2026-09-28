import { Ionicons } from '@expo/vector-icons';
import { can, formatMoney, type AppointmentDto, type AvailabilitySlot, type Client, type Item } from '@xiro/shared';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ApiError, api } from '@/lib/api';
import { formatClock, localDate, localTime, todayIn } from '@/lib/agenda';
import { apiErrors } from '@/lib/forms';
import { useClients, useItems, usePackages, useProfessionals, useVariants } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { CheckRow } from '../CheckRow';
import { Field } from '../Field';
import { FormModal } from '../FormModal';
import { Card, Chip, ChipRow, SectionTitle } from '../Kit';
import { AppText } from '../Text';
import { radius } from '../theme';
import { SchedulePicker } from './SchedulePicker';

interface Props {
  onClose: () => void;
  onCreated: (appointment: AppointmentDto) => void;
  /** Día con el que abre el calendario (el que se está mirando en la agenda). */
  initialDate: string;
  /** Profesional preseleccionado (el que se está filtrando en la agenda). */
  initialProfessionalId?: string;
}

interface Alternative {
  time: string;
  startsAt: string;
}

/** Fila de un servicio: casilla + (si está marcado y tiene estilos) selector de estilo con su precio. */
function ServiceRow({ item, selected, variantId, onToggle, onVariant, currency }: { item: Item; selected: boolean; variantId: string | null; onToggle: (next: boolean) => void; onVariant: (id: string | null) => void; currency: Parameters<typeof formatMoney>[1] }) {
  const { t } = useSettings();
  const variants = useVariants(selected ? item.id : undefined);
  const active = (variants.data ?? []).filter((v) => v.active);
  return (
    <View>
      <CheckRow label={item.name} hint={`${formatMoney(item.price, currency)} · ${t('minutes_short', { minutes: item.durationMinutes })}`} checked={selected} onChange={onToggle} />
      {selected && active.length > 0 ? (
        <View style={{ paddingLeft: 36, paddingBottom: 6 }}>
          <AppText variant="small" tone="muted" style={{ marginBottom: 4 }}>
            {t('appt_style')}
          </AppText>
          <ChipRow label={t('appt_style')}>
            <Chip label={t('appt_style_base')} selected={variantId === null} onPress={() => onVariant(null)} />
            {active.map((v) => (
              <Chip key={v.id} label={`${v.name} · ${formatMoney(v.price, currency)}`} selected={variantId === v.id} onPress={() => onVariant(v.id)} />
            ))}
          </ChipRow>
        </View>
      ) : null}
    </View>
  );
}

/**
 * "Nueva cita" del personal: cliente (existente o nuevo), qué se hace, con quién, cuándo (calendario + horarios reales) y
 * notas. Un solo formulario, sin pasos ocultos. Si el horario se ocupa mientras se llena, el servidor responde `slot_taken`
 * y aquí se ofrecen los horarios libres más cercanos.
 */
export function NewAppointment({ onClose, onCreated, initialDate, initialProfessionalId }: Props) {
  const { t, language } = useSettings();
  const { user, business } = useSession();
  const timezone = business?.timezone ?? 'America/Bogota';
  const currency = business?.currency ?? 'COP';
  const seesAll = user ? can({ role: user.role, permissions: user.permissions }, 'agenda_all') : false;

  const items = useItems();
  const packages = usePackages();
  const professionals = useProfessionals();

  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [query, setQuery] = useState('');
  const clients = useClients(query.trim(), clientMode === 'existing');
  const [client, setClient] = useState<Client | null>(null);
  const [newClient, setNewClient] = useState({ name: '', phone: '', email: '' });

  const [services, setServices] = useState<Record<string, string | null>>({});
  const [chosenPackages, setChosenPackages] = useState<string[]>([]);
  const [products, setProducts] = useState<Record<string, number>>({});

  const bookable = (professionals.data ?? []).filter((p) => p.bookable);
  const [professionalId, setProfessionalId] = useState<string>(initialProfessionalId ?? (seesAll ? 'any' : (user?.id ?? 'any')));
  const [date, setDate] = useState(initialDate < todayIn(timezone) ? todayIn(timezone) : initialDate);
  const [slot, setSlot] = useState<string | null>(null);
  const [notes, setNotes] = useState({ customer: '', internal: '' });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [busy, setBusy] = useState(false);

  const serviceItems = (items.data ?? []).filter((i) => i.kind === 'service' && i.bookable);
  const productItems = (items.data ?? []).filter((i) => i.kind === 'product' && i.bookable && i.stock > 0);

  const selection = useMemo(
    () => ({ services: Object.entries(services).map(([itemId, variantId]) => ({ itemId, variantId })), packages: chosenPackages }),
    [services, chosenPackages],
  );
  const hasSelection = selection.services.length + selection.packages.length > 0;

  const estimate = useMemo(() => {
    let total = 0;
    for (const [id] of Object.entries(services)) total += serviceItems.find((i) => i.id === id)?.price ?? 0;
    for (const id of chosenPackages) total += packages.data?.find((p) => p.id === id)?.price ?? 0;
    for (const [id, qty] of Object.entries(products)) total += (productItems.find((i) => i.id === id)?.price ?? 0) * qty;
    return total;
    // Los estilos con precio propio se reflejan al guardar; aquí solo se estima con el precio base.
  }, [services, chosenPackages, products, serviceItems, productItems, packages.data]);

  const toggleService = (id: string, on: boolean) => {
    setSlot(null);
    setServices((current) => {
      const next = { ...current };
      if (on) next[id] = null;
      else delete next[id];
      return next;
    });
  };

  async function submit() {
    setGeneral(undefined);
    setAlternatives([]);
    const found: Record<string, string> = {};
    if (clientMode === 'existing' && !client) found.client = t('appt_err_client');
    if (clientMode === 'new' && !newClient.name.trim()) found.newName = t('required');
    if (!hasSelection) found.services = t('appt_err_services');
    if (!slot) found.slot = t('appt_err_slot');
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const created = await api.createAppointment({
        ...(clientMode === 'existing' ? { clientId: client!.id } : { newClient: { name: newClient.name.trim(), ...(newClient.phone.trim() ? { phone: newClient.phone.trim() } : {}), ...(newClient.email.trim() ? { email: newClient.email.trim() } : {}) } }),
        professionalId: professionalId === 'any' && bookable.length === 1 ? bookable[0]!.id : professionalId,
        startsAt: slot!,
        selection: {
          services: selection.services,
          packages: selection.packages,
          products: Object.entries(products).map(([itemId, quantity]) => ({ itemId, quantity })),
        },
        source: 'app',
        customerNotes: notes.customer.trim(),
        internalNotes: notes.internal.trim(),
      });
      onCreated(created);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'slot_taken') {
        const list = (error.extra.alternatives as AvailabilitySlot[] | undefined) ?? [];
        setAlternatives(list.map((a) => ({ time: a.time, startsAt: a.startsAt })));
        setSlot(null);
        setGeneral(t('slot_taken'));
      } else {
        const result = apiErrors(error, t);
        setErrors({ ...(result.fields.newClient ? { newPhone: result.fields.newClient } : {}), ...result.fields });
        setGeneral(result.general ?? (Object.keys(result.fields).length > 0 ? t('appt_err_fix') : undefined));
      }
    } finally {
      setBusy(false);
    }
  }

  const pickAlternative = (alt: Alternative) => {
    setDate(localDate(alt.startsAt, timezone));
    setSlot(alt.startsAt);
    setAlternatives([]);
    setGeneral(undefined);
  };

  return (
    <FormModal
      title={t('appt_new_title')}
      onClose={onClose}
      footer={
        <>
          {general ? (
            <AppText tone="danger" accessibilityLiveRegion="polite">
              {general}
            </AppText>
          ) : null}
          {alternatives.length > 0 ? (
            <View>
              <AppText variant="small" tone="muted" style={{ marginBottom: 6 }}>
                {t('appt_alternatives')}
              </AppText>
              <ChipRow label={t('appt_alternatives')}>
                {alternatives.map((alt) => (
                  <Chip key={alt.startsAt} label={`${localDate(alt.startsAt, timezone).slice(5)} · ${formatClock(localTime(alt.startsAt, timezone), language)}`} onPress={() => pickAlternative(alt)} />
                ))}
              </ChipRow>
            </View>
          ) : null}
          <View style={styles.totalRow}>
            <AppText tone="muted">{t('appt_estimate')}</AppText>
            <AppText variant="heading">{formatMoney(estimate, currency)}</AppText>
          </View>
          <Button label={t('appt_create')} onPress={() => void submit()} loading={busy} />
        </>
      }>
      <SectionTitle>{t('appt_client')}</SectionTitle>
      <ChipRow label={t('appt_client')}>
        <Chip label={t('appt_client_existing')} selected={clientMode === 'existing'} onPress={() => setClientMode('existing')} />
        <Chip label={t('appt_client_new')} selected={clientMode === 'new'} onPress={() => setClientMode('new')} />
      </ChipRow>
      {clientMode === 'existing' ? (
        <View style={{ marginTop: 10 }}>
          {client ? (
            <Card>
              <View style={styles.selectedClient}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">{client.name}</AppText>
                  <AppText variant="small" tone="muted">
                    {client.phone ?? client.email ?? ''}
                  </AppText>
                </View>
                <Button label={t('change')} variant="ghost" compact onPress={() => setClient(null)} />
              </View>
            </Card>
          ) : (
            <>
              <Field label={t('appt_client_search')} value={query} onChangeText={setQuery} autoCapitalize="none" />
              {clients.isLoading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
              {(clients.data ?? []).slice(0, 6).map((c) => (
                <Pressable key={c.id} accessibilityRole="button" onPress={() => setClient(c)} style={styles.clientRow}>
                  <Ionicons name="person-circle-outline" size={26} color="#9a8f6a" />
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong">{c.name}</AppText>
                    <AppText variant="small" tone="muted">
                      {c.phone ?? c.email ?? ''}
                    </AppText>
                  </View>
                </Pressable>
              ))}
              {clients.data && clients.data.length === 0 ? <AppText tone="muted">{t('appt_client_none')}</AppText> : null}
            </>
          )}
          {errors.client ? (
            <AppText variant="small" tone="danger">
              {errors.client}
            </AppText>
          ) : null}
        </View>
      ) : (
        <View style={{ marginTop: 10 }}>
          <Field label={`${t('full_name')} *`} value={newClient.name} onChangeText={(v) => setNewClient((c) => ({ ...c, name: v }))} error={errors.newName} maxLength={80} />
          <Field label={t('phone')} value={newClient.phone} onChangeText={(v) => setNewClient((c) => ({ ...c, phone: v }))} error={errors.newPhone} keyboardType="phone-pad" />
          <Field label={t('email')} value={newClient.email} onChangeText={(v) => setNewClient((c) => ({ ...c, email: v }))} keyboardType="email-address" autoCapitalize="none" />
        </View>
      )}

      <SectionTitle>{t('appt_services')}</SectionTitle>
      {items.isLoading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
      {items.data && serviceItems.length === 0 && (packages.data ?? []).length === 0 ? <AppText tone="muted">{t('appt_no_services')}</AppText> : null}
      {serviceItems.map((item) => (
        <ServiceRow
          key={item.id}
          item={item}
          currency={currency}
          selected={item.id in services}
          variantId={services[item.id] ?? null}
          onToggle={(on) => toggleService(item.id, on)}
          onVariant={(id) => {
            setSlot(null);
            setServices((current) => ({ ...current, [item.id]: id }));
          }}
        />
      ))}
      {(packages.data ?? []).filter((p) => p.active).map((p) => (
        <CheckRow
          key={p.id}
          label={p.name}
          hint={formatMoney(p.price, currency)}
          checked={chosenPackages.includes(p.id)}
          onChange={(on) => {
            setSlot(null);
            setChosenPackages((current) => (on ? [...current, p.id] : current.filter((id) => id !== p.id)));
          }}
        />
      ))}
      {errors.services ? (
        <AppText variant="small" tone="danger">
          {errors.services}
        </AppText>
      ) : null}

      {productItems.length > 0 ? (
        <>
          <SectionTitle>{t('appt_products')}</SectionTitle>
          {productItems.map((item) => {
            const qty = products[item.id] ?? 0;
            return (
              <View key={item.id} style={styles.productRow}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">{item.name}</AppText>
                  <AppText variant="small" tone="muted">
                    {formatMoney(item.price, currency)}
                  </AppText>
                </View>
                <Button label="−" variant="secondary" compact disabled={qty === 0} onPress={() => setProducts((c) => ({ ...c, [item.id]: Math.max(0, qty - 1) }))} />
                <AppText variant="bodyStrong" style={{ minWidth: 22, textAlign: 'center' }}>
                  {qty}
                </AppText>
                <Button label="+" variant="secondary" compact disabled={qty >= Math.min(20, item.stock)} onPress={() => setProducts((c) => ({ ...c, [item.id]: qty + 1 }))} />
              </View>
            );
          })}
        </>
      ) : null}

      <SectionTitle>{t('appt_professional')}</SectionTitle>
      {professionals.data && bookable.length === 0 ? <AppText tone="muted">{t('appt_no_professionals')}</AppText> : null}
      <ChipRow label={t('appt_professional')}>
        {seesAll && bookable.length > 1 ? <Chip label={t('appt_any_professional')} selected={professionalId === 'any'} onPress={() => { setProfessionalId('any'); setSlot(null); }} /> : null}
        {bookable
          .filter((p) => seesAll || p.id === user?.id)
          .map((p) => (
            <Chip key={p.id} label={p.publicName} selected={professionalId === p.id || (professionalId === 'any' && bookable.length === 1)} onPress={() => { setProfessionalId(p.id); setSlot(null); }} />
          ))}
      </ChipRow>

      <SectionTitle>{t('appt_when')}</SectionTitle>
      <SchedulePicker
        selection={selection}
        professionalId={professionalId === 'any' && bookable.length === 1 ? bookable[0]!.id : professionalId}
        timezone={timezone}
        date={date}
        onDate={(d) => {
          setDate(d);
          setSlot(null);
        }}
        slot={slot}
        onSlot={(s) => setSlot(s.startsAt)}
      />
      {errors.slot ? (
        <AppText variant="small" tone="danger" style={{ marginTop: 6 }}>
          {errors.slot}
        </AppText>
      ) : null}

      <SectionTitle>{t('appt_notes')}</SectionTitle>
      <Field label={t('appt_customer_notes')} value={notes.customer} onChangeText={(v) => setNotes((n) => ({ ...n, customer: v }))} multiline maxLength={500} />
      <Field label={t('appt_internal_notes')} value={notes.internal} onChangeText={(v) => setNotes((n) => ({ ...n, internal: v }))} hint={t('appt_internal_hint')} multiline maxLength={1000} />
    </FormModal>
  );
}

const styles = StyleSheet.create({
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectedClient: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderRadius: radius.md },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
});
