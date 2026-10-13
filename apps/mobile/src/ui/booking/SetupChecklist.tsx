import { Ionicons } from '@expo/vector-icons';
import type { BookingReadiness } from '@xiro/shared';
import { View } from 'react-native';
import { setupSteps, type SetupStepId } from '@/lib/bookingPage';
import { useSettings } from '@/lib/settings';
import { Button, Card } from './PanelKit';
import { AppText } from '../Text';

const ACTION_KEY: Record<SetupStepId, string> = {
  published: 'bk_setup_published',
  services: 'bk_setup_go_service',
  professionals: 'bk_setup_go_team',
  hours: 'bk_setup_go_hours',
};

/**
 * Lista de pasos que le dice al dueño exactamente qué le falta para que sus clientes puedan reservar (un negocio con solo
 * productos, sin nadie que atienda o sin horario nunca ofrece horarios). Cuando todo está listo se reduce a una línea.
 */
export function SetupChecklist({ readiness, onAction, busy }: { readiness: BookingReadiness; onAction: (id: SetupStepId) => void; busy?: boolean }) {
  const { t, colors } = useSettings();
  const steps = setupSteps(readiness);
  const done = steps.filter((s) => s.done).length;

  if (readiness.ready) {
    return (
      <Card style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <AppText variant="bodyStrong" style={{ flex: 1 }}>
            {t('bk_setup_ready')}
          </AppText>
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: 12 }}>
      <AppText variant="bodyStrong" accessibilityRole="header">
        {t('bk_setup_title')}
      </AppText>
      <AppText variant="small" tone="muted" style={{ marginTop: 2, marginBottom: 10 }}>
        {t('bk_setup_progress', { done, total: steps.length })}
      </AppText>
      <View style={{ gap: 12 }}>
        {steps.map((step) => (
          <View key={step.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }} accessible accessibilityLabel={`${t(`bk_setup_${step.id}`)}: ${t(step.done ? 'bk_setup_done' : 'bk_setup_pending')}`}>
            <Ionicons name={step.done ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={step.done ? colors.success : colors.textMuted} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{t(`bk_setup_${step.id}`)}</AppText>
              {!step.done ? (
                <>
                  <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                    {t(`bk_setup_${step.id}_hint`)}
                  </AppText>
                  <Button label={t(ACTION_KEY[step.id])} compact variant="secondary" disabled={busy} onPress={() => onAction(step.id)} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
                </>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}
