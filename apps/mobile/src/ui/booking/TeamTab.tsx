import { useQueryClient } from '@tanstack/react-query';
import type { ProfessionalDto } from '@xiro/shared';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { keys, useProfessionals } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { Card, EmptyState, Photo, ToggleRow } from '../Kit';
import { AppText } from '../Text';
import { ProfessionalEditor } from './ProfessionalEditor';
import { useAction } from './useAction';

/**
 * Quién atiende citas. El dueño decide si él mismo aparece ("Yo también atiendo citas") y cada persona del equipo puede
 * atender o no, mostrarse o no en la web y tener su propio horario, servicios y ausencias.
 */
export function TeamTab() {
  const { t } = useSettings();
  const queryClient = useQueryClient();
  const professionals = useProfessionals();
  const toggle = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const editingProfessional = professionals.data?.find((p) => p.id === editing) ?? null;

  async function update(professional: ProfessionalDto, body: { bookable?: boolean; visible?: boolean }) {
    const saved = await toggle.run(() => api.updateProfessional(professional.id, body));
    if (saved) await queryClient.invalidateQueries({ queryKey: keys.professionals });
  }

  if (professionals.isLoading) return <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel={t('loading')} />;
  if (professionals.isError) {
    return (
      <View style={{ gap: 8 }}>
        <AppText tone="danger">{t(errorKey(professionals.error))}</AppText>
        <Button label={t('retry')} variant="secondary" compact onPress={() => void professionals.refetch()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <AppText tone="muted">{t('team_tab_hint')}</AppText>
      {toggle.error ? (
        <AppText tone="danger" accessibilityLiveRegion="polite">
          {toggle.error}
        </AppText>
      ) : null}
      {(professionals.data ?? []).length === 0 ? <EmptyState icon="people-outline" message={t('team_tab_empty')} /> : null}
      {(professionals.data ?? []).map((p) => (
        <Card key={p.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Photo url={p.photoUrl} size={56} icon="person-outline" />
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{p.publicName}</AppText>
              <AppText variant="small" tone="muted">
                {p.isOwner ? t('prof_you') : p.name}
                {p.bookable ? ` · ${p.schedule.length > 0 ? t('team_own_schedule') : t('team_business_schedule')}` : ''}
              </AppText>
            </View>
          </View>
          <ToggleRow label={p.isOwner ? t('team_owner_attends') : t('team_attends')} value={p.bookable} onChange={(v) => void update(p, { bookable: v })} />
          {p.bookable ? (
            <>
              <ToggleRow label={t('team_visible')} value={p.visible} onChange={(v) => void update(p, { visible: v })} />
              <Button label={t('team_edit')} variant="secondary" compact onPress={() => setEditing(p.id)} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
            </>
          ) : null}
        </Card>
      ))}
      {editingProfessional ? <ProfessionalEditor professional={editingProfessional} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}
