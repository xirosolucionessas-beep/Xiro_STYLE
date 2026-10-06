import { formatCoords, type PickedLocation } from '@xiro/shared';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocationPicker } from '@/lib/useLocationPicker';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { Field } from '../Field';
import { AppText } from '../Text';
import { radius } from '../theme';
import { LocationMap } from './LocationMap';

/**
 * Selector de ubicación del local ("Mi página web"): buscador con autocompletado, pegar coordenadas o un enlace de Google Maps,
 * "usar mi ubicación actual", mapa con el pin (arrastrable en web) y la dirección elegida con su botón "Quitar".
 * Opcional: sin ubicación no se muestra ningún mapa en la página pública. La lógica vive en lib/useLocationPicker.ts.
 */
export function LocationPicker({ value, onChange }: { value: PickedLocation | null; onChange: (next: PickedLocation | null) => void }) {
  const { t, language, colors } = useSettings();
  const picker = useLocationPicker({ value, onChange, language });
  const hasOptions = picker.coordsOffer !== null || picker.suggestions.length > 0;

  return (
    <View>
      <Field
        label={t('bk_loc_search_label')}
        value={picker.query}
        onChangeText={picker.changeQuery}
        placeholder={t('bk_loc_search_placeholder')}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {picker.configLoaded && !picker.searchEnabled ? (
        <AppText variant="small" tone="muted" style={styles.line}>
          {t('bk_loc_not_configured')}
        </AppText>
      ) : null}
      {picker.status ? (
        <AppText variant="small" tone="muted" style={styles.line} accessibilityLiveRegion="polite">
          {t(picker.status)}
        </AppText>
      ) : null}
      {picker.error ? (
        <AppText variant="small" tone="danger" style={styles.line} accessibilityLiveRegion="polite">
          {t(picker.error)}
        </AppText>
      ) : null}

      {hasOptions ? (
        <View style={[styles.list, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {picker.coordsOffer ? (
            <Pressable accessibilityRole="button" onPress={() => void picker.applyCoords(picker.coordsOffer!)} style={[styles.row, { borderBottomColor: colors.border }]}>
              <Ionicons name="pin" size={18} color={colors.textMuted} />
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {t('bk_loc_use_coords', { coords: formatCoords(picker.coordsOffer) })}
              </AppText>
            </Pressable>
          ) : null}
          {picker.suggestions.map((suggestion, index) => (
            <Pressable
              key={suggestion.placeId}
              accessibilityRole="button"
              accessibilityLabel={suggestion.secondaryText ? `${suggestion.text}, ${suggestion.secondaryText}` : suggestion.text}
              onPress={() => void picker.pick(suggestion)}
              style={[styles.row, index < picker.suggestions.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
              <Ionicons name="location-outline" size={18} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{suggestion.text}</AppText>
                {suggestion.secondaryText ? (
                  <AppText variant="small" tone="muted">
                    {suggestion.secondaryText}
                  </AppText>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Button label={t('bk_loc_use_current')} icon="locate-outline" variant="secondary" compact loading={picker.status === 'bk_loc_locating'} disabled={picker.busy} onPress={() => void picker.locate()} style={styles.locate} />

      {value ? (
        <View style={{ marginTop: 14 }}>
          <LocationMap point={value} onMove={(point) => void picker.movePin(point)} />
          <View style={[styles.selected, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={{ flex: 1 }}>
              <AppText variant="label" tone="gold">
                {t('bk_loc_selected')}
              </AppText>
              <AppText variant="bodyStrong" style={{ marginTop: 2 }} accessibilityLiveRegion="polite">
                {picker.status === 'bk_loc_updating_address' ? t('bk_loc_updating_address') : value.address || t('bk_loc_no_address')}
              </AppText>
              <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                {formatCoords(value)}
              </AppText>
            </View>
            <Button label={t('bk_loc_remove')} variant="ghost" compact disabled={picker.busy} onPress={picker.clear} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { marginBottom: 6 },
  list: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  locate: { alignSelf: 'flex-start' },
  selected: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 12, marginTop: 10 },
});
