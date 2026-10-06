import { useQueryClient } from '@tanstack/react-query';
import type { BookingAdminSettings } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { api, publicBaseUrl } from '@/lib/api';
import { publicPageUrl, slugProblem, suggestSlug, whatsappShareUrl, type SetupStepId } from '@/lib/bookingPage';
import { keys } from '@/lib/queries';
import { copyOrShare } from '@/lib/share';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { useDialogs } from '../Dialogs';
import { Field } from '../Field';
import { Card, SectionTitle, ToggleRow } from '../Kit';
import { AppText } from '../Text';
import { SetupChecklist } from './SetupChecklist';
import { useAction } from './useAction';

/** Publicar la página, ver y compartir su enlace, y cambiar su dirección (la anterior sigue funcionando y redirige a la nueva). */
export function LinkTab({ data, onGoTab }: { data: BookingAdminSettings; onGoTab: (tab: 'team') => void }) {
  const router = useRouter();
  const { t } = useSettings();
  const { business } = useSession();
  const { toast, confirm } = useDialogs();
  const queryClient = useQueryClient();
  const publish = useAction();
  const slugAction = useAction();
  const [slug, setSlug] = useState(data.slug);
  const [availability, setAvailability] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setSlug(data.slug), [data.slug]);
  const url = publicPageUrl(data.slug, publicBaseUrl());
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.bookingSettings });

  async function setPublished(published: boolean) {
    const saved = await publish.run(() => api.saveBookingProfile({ published }));
    if (!saved) return;
    await refresh();
    toast(published ? t('bk_published_on') : t('bk_published_off'));
  }

  function goSetup(step: SetupStepId) {
    if (step === 'published') void setPublished(true);
    else if (step === 'services') router.push('/item/form');
    else if (step === 'professionals') onGoTab('team');
    else router.push('/business');
  }

  async function copy() {
    const result = await copyOrShare(t('bk_share_text', { name: business?.name ?? '', url }));
    toast(result === 'copied' ? t('bk_link_copied') : result === 'shared' ? t('bk_link_shared') : t('bk_link_copy_failed'));
  }

  async function check() {
    const normalized = slug.trim().toLowerCase();
    const problem = slugProblem(normalized);
    if (problem) return setAvailability({ ok: false, text: t(problem) });
    if (normalized === data.slug) return setAvailability({ ok: true, text: t('bk_slug_current') });
    const result = await slugAction.run(() => api.checkSlug(normalized));
    if (result) setAvailability(result.available ? { ok: true, text: t('bk_slug_free') } : { ok: false, text: t(result.reason ?? 'slug_taken') });
  }

  async function saveSlug() {
    const normalized = slug.trim().toLowerCase();
    const problem = slugProblem(normalized);
    if (problem) return setAvailability({ ok: false, text: t(problem) });
    if (normalized === data.slug) return;
    const ok = await confirm({ title: t('bk_slug_confirm_title'), message: t('bk_slug_confirm_text', { slug: normalized }), confirmLabel: t('bk_slug_change') });
    if (!ok) return;
    const saved = await slugAction.run(() => api.saveSlug(normalized));
    if (!saved) return;
    setAvailability(null);
    await refresh();
    await queryClient.invalidateQueries({ queryKey: keys.items });
    toast(t('bk_slug_saved'));
  }

  return (
    <View>
      <SetupChecklist readiness={data.readiness} busy={publish.busy} onAction={goSetup} />
      <Card>
        <ToggleRow label={t('bk_published')} value={data.profile.published} onChange={(v) => void setPublished(v)} icon="globe-outline" />
        <AppText variant="small" tone="muted">
          {data.profile.published ? t('bk_published_hint_on') : t('bk_published_hint_off')}
        </AppText>
        {publish.error ? (
          <AppText tone="danger" style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
            {publish.error}
          </AppText>
        ) : null}
      </Card>

      <SectionTitle>{t('bk_your_link')}</SectionTitle>
      <Card>
        <AppText variant="bodyStrong" selectable accessibilityLabel={`${t('bk_your_link')}: ${url}`}>
          {url}
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <Button label={t('bk_copy')} icon="copy-outline" compact onPress={() => void copy()} />
          <Button label={t('bk_open')} icon="open-outline" variant="secondary" compact disabled={!data.profile.published} onPress={() => void Linking.openURL(url)} />
          <Button label="WhatsApp" icon="logo-whatsapp" variant="secondary" compact onPress={() => void Linking.openURL(whatsappShareUrl(t('bk_share_text', { name: business?.name ?? '', url })))} />
        </View>
        {!data.profile.published ? (
          <AppText variant="small" tone="muted" style={{ marginTop: 10 }}>
            {t('bk_link_needs_publish')}
          </AppText>
        ) : null}
      </Card>

      <SectionTitle>{t('bk_slug_title')}</SectionTitle>
      <Field
        label={t('bk_slug_label')}
        value={slug}
        onChangeText={(v) => {
          setSlug(v);
          setAvailability(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={40}
        hint={t('bk_slug_hint')}
        error={slugAction.fields.slug ?? (availability && !availability.ok ? availability.text : undefined)}
      />
      {availability?.ok ? (
        <AppText tone="success" style={{ marginBottom: 8 }} accessibilityLiveRegion="polite">
          {availability.text}
        </AppText>
      ) : null}
      {slugAction.error ? (
        <AppText tone="danger" style={{ marginBottom: 8 }} accessibilityLiveRegion="polite">
          {slugAction.error}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button label={t('bk_slug_check')} variant="secondary" compact loading={slugAction.busy} onPress={() => void check()} />
        <Button label={t('bk_slug_change')} compact disabled={slugAction.busy || slug.trim().toLowerCase() === data.slug} onPress={() => void saveSlug()} />
        {business ? <Button label={t('bk_slug_suggest')} variant="ghost" compact onPress={() => { setSlug(suggestSlug(business.name)); setAvailability(null); }} /> : null}
      </View>
      <AppText variant="small" tone="muted" style={{ marginTop: 10 }}>
        {t('bk_slug_old_links')}
      </AppText>
    </View>
  );
}
