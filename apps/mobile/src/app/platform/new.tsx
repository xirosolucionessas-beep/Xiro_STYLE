import { platformCreateBusinessSchema, type PlatformCreateBusinessResult } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { platformApi, usePlatformSession } from '@/lib/platformApi';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { Card } from '@/ui/Kit';
import { AccessBadge, formatDate, KV, newKey, Segmented, styles, Titled, useSensitiveAction } from '@/ui/platform/parts';
import { usePlatformText } from '@/ui/platform/strings';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

const TYPES = ['barbershop', 'beauty_salon', 'spa', 'nails', 'other'] as const;
type Access = 'none' | 'days' | 'months';

/**
 * Alta de un negocio desde el panel (solo el fundador; el servidor lo vuelve a comprobar). El fundador nunca escribe ni ve
 * una contraseña: el dueño crea la suya con "¿Olvidaste tu contraseña?". Una clave por formulario: reintentos y dobles clics
 * devuelven la MISMA cuenta.
 */
export default function PlatformNewBusiness() {
  const { pt, language } = usePlatformText();
  const router = useRouter();
  const dialogs = useDialogs();
  const { admin } = usePlatformSession();
  const action = useSensitiveAction(pt);
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState<(typeof TYPES)[number]>('barbershop');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [accountLanguage, setAccountLanguage] = useState<'es' | 'en'>(language === 'en' ? 'en' : 'es');
  const [access, setAccess] = useState<Access>('none');
  const [amount, setAmount] = useState('30');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<PlatformCreateBusinessResult | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/platform'));

  const n = Number.parseInt(amount, 10);
  const input = {
    businessName: businessName.trim(),
    businessType,
    ownerName: ownerName.trim(),
    ownerEmail: ownerEmail.trim().toLowerCase(),
    language: accountLanguage,
    ...(access === 'none' ? {} : { initialAccess: { unit: access, amount: Number.isNaN(n) ? 0 : n } }),
    reason: reason.trim(),
    idempotencyKey,
  };
  // Mismas reglas que el servidor (esquema compartido); el servidor valida de nuevo.
  const parsed = platformCreateBusinessSchema.safeParse(input);
  const issue = (field: string) => {
    if (!submitted || parsed.success) return undefined;
    const found = parsed.error.issues.find((i) => i.path[0] === field);
    if (!found) return undefined;
    if (field === 'ownerEmail') return pt('email_invalid');
    if (field === 'reason') return pt('reason_too_short');
    if (field === 'initialAccess') return pt('amount_range', { max: access === 'months' ? 24 : 366 });
    return pt('required_field');
  };

  async function submit() {
    setSubmitted(true);
    if (!parsed.success) return;
    const accessText = access === 'none' ? pt('new_initial_none') : `${n} ${pt(access === 'days' ? 'unit_days_lc' : 'unit_months_lc')}`;
    const message = [`${pt('new_business_name')}: ${input.businessName}`, `${pt('new_owner_name')}: ${input.ownerName}`, `${pt('new_owner_email')}: ${input.ownerEmail}`, `${pt('new_initial_access')}: ${accessText}`].join('\n');
    if (!(await dialogs.confirm({ title: pt('new_confirm_title'), message, confirmLabel: pt('new_submit') }))) return;
    let created: PlatformCreateBusinessResult | null = null;
    const ok = await action.run(async () => {
      created = await platformApi.createBusiness(parsed.data);
    });
    // Éxito solo con la respuesta confirmada del servidor.
    if (ok && created) setResult(created);
  }

  function another() {
    setResult(null);
    setSubmitted(false);
    setBusinessName('');
    setOwnerName('');
    setOwnerEmail('');
    setReason('');
    setAccess('none');
    setIdempotencyKey(newKey());
  }

  return (
    <Screen header={<Header title={pt('new_title')} onBack={back} />}>
      {!admin?.isFounder ? (
        <Card>
          <AppText tone="danger">{pt('new_founder_only')}</AppText>
        </Card>
      ) : result ? (
        <Card style={{ gap: 10 }} >
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ gap: 6 }}>
            <AppText variant="title">{pt('new_done_title')}</AppText>
            {result.replayed ? <AppText tone="muted">{pt('new_done_replayed')}</AppText> : null}
          </View>
          <View style={styles.row}>
            <AppText variant="heading" style={styles.flex}>
              {result.business.name}
            </AppText>
            <AccessBadge status={result.business.accessStatus} pt={pt} />
          </View>
          <KV label={pt('search_kind_slug')} value={result.business.slug} />
          <KV label={pt('new_owner_email')} value={result.ownerEmailMasked ?? '—'} />
          <KV label={pt('new_done_access')} value={result.initialAccessEndsAt ? formatDate(result.initialAccessEndsAt, language) : pt('not_applicable')} strong />
          <Card style={{ gap: 4 }}>
            <AppText variant="bodyStrong">{pt('new_next_title')}</AppText>
            <AppText>{pt('new_next_body', { email: result.ownerEmailMasked ?? '—' })}</AppText>
          </Card>
          <View style={styles.row}>
            <Button label={pt('new_open_business')} compact onPress={() => router.replace(`/platform/business/${result.business.id}`)} />
            <Button label={pt('new_another')} variant="secondary" compact onPress={another} />
          </View>
        </Card>
      ) : (
        <Card style={{ gap: 12 }}>
          <Titled title={pt('new_title')} pt={pt} />
          <AppText variant="small" tone="muted">
            {pt('new_help')}
          </AppText>
          <Field label={pt('new_business_name')} value={businessName} onChangeText={setBusinessName} maxLength={80} error={issue('businessName')} />
          <AppText variant="label" tone="muted">
            {pt('new_business_type')}
          </AppText>
          <Segmented label={pt('new_business_type')} options={TYPES.map((t) => ({ value: t, label: pt(`type_${t}`) }))} value={businessType} onChange={setBusinessType} />
          <Field label={pt('new_owner_name')} value={ownerName} onChangeText={setOwnerName} maxLength={80} error={issue('ownerName')} />
          <Field
            label={pt('new_owner_email')}
            hint={pt('new_owner_email_help')}
            value={ownerEmail}
            onChangeText={setOwnerEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="off"
            maxLength={254}
            error={issue('ownerEmail')}
          />
          <AppText variant="label" tone="muted">
            {pt('new_language')}
          </AppText>
          <Segmented
            label={pt('new_language')}
            options={[
              { value: 'es', label: pt('lang_es') },
              { value: 'en', label: pt('lang_en') },
            ]}
            value={accountLanguage}
            onChange={setAccountLanguage}
          />
          <Titled title={pt('new_initial_access')} help={pt('new_initial_access_help')} pt={pt} variant="label" />
          <Segmented
            label={pt('new_initial_access')}
            options={[
              { value: 'none', label: pt('new_initial_none') },
              { value: 'days', label: pt('unit_days') },
              { value: 'months', label: pt('unit_months') },
            ]}
            value={access}
            onChange={setAccess}
          />
          {access !== 'none' ? (
            <Field
              label={pt('amount')}
              hint={pt('amount_range', { max: access === 'months' ? 24 : 366 })}
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 3))}
              keyboardType="number-pad"
              error={issue('initialAccess')}
            />
          ) : null}
          <Field label={pt('new_reason')} value={reason} onChangeText={setReason} multiline maxLength={500} error={issue('reason')} />
          <Button label={pt('new_submit')} icon="add-circle-outline" loading={action.busy} onPress={() => void submit()} />
          {action.ui}
        </Card>
      )}
    </Screen>
  );
}
