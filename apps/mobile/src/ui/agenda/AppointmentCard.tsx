import { formatMoney, type AppointmentDto, type Currency } from '@xiro/shared';
import { StyleSheet, View } from 'react-native';
import { formatSpan, summarizeItems } from '@/lib/agenda';
import { useSettings } from '@/lib/settings';
import { Card } from '../Kit';
import { AppText } from '../Text';
import { StatusBadge } from './StatusBadge';

/** Una cita en la lista de la agenda: hora, estado, cliente, qué se hace y cuánto. Toda la tarjeta abre la ficha. */
export function AppointmentCard({ appointment, timezone, currency, showProfessional, onPress }: { appointment: AppointmentDto; timezone: string; currency: Currency; showProfessional: boolean; onPress: () => void }) {
  const { language, t } = useSettings();
  const dim = appointment.status === 'cancelled' || appointment.status === 'no_show';
  const span = formatSpan(appointment.startsAt, appointment.endsAt, timezone, language);
  return (
    <Card onPress={onPress} style={dim ? { opacity: 0.65 } : undefined}>
      <View style={styles.top}>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {span}
        </AppText>
        <StatusBadge status={appointment.status} />
      </View>
      <AppText variant="heading" style={{ marginTop: 4 }} numberOfLines={1}>
        {appointment.client.name}
      </AppText>
      <AppText tone="muted" numberOfLines={2} accessibilityLabel={`${t('appt_services')}: ${summarizeItems(appointment.items, 5)}`}>
        {summarizeItems(appointment.items)}
      </AppText>
      <View style={styles.bottom}>
        {showProfessional ? (
          <AppText variant="small" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
            {t('appt_professional_is', { name: appointment.professional.name })}
          </AppText>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <AppText variant="bodyStrong" tone="gold">
          {formatMoney(appointment.totalPrice - (appointment.discount?.amount ?? 0), currency)}
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
});
