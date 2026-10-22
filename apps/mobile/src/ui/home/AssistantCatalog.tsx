import { ASSISTANT_CATALOG, REPORT_PERIODS, type AssistantCatalogEntry, type AssistantCategory, type AssistantQuestionKey, type ReportPeriod } from '@xiro/shared';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { Chip, ChipRow } from '../Kit';
import { Field } from '../Field';
import { AppText } from '../Text';

/**
 * "Ver todas las preguntas" (sección 1 de la propuesta de diseño): categorías, buscador y, si la pregunta lo exige,
 * un período antes de ejecutarla. Al elegir, `onPick` corre la pregunta y el resultado llega como un mensaje más del
 * chat — esta vista es solo OTRA forma de producir esa misma pregunta, no cambia cómo se muestran las respuestas.
 */
export function AssistantCatalog({ onPick, onClose }: { onPick: (question: AssistantQuestionKey, period?: ReportPeriod) => void; onClose: () => void }) {
  const { t } = useSettings();
  const [entries, setEntries] = useState<AssistantCatalogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [periodFor, setPeriodFor] = useState<AssistantQuestionKey | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .assistantCatalog()
      .then((rows) => alive && setEntries(rows))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = (entries ?? []).filter((e) => !q || t(`assistant_q_${e.question}`).toLowerCase().includes(q));
    const byCategory = new Map<AssistantCategory, AssistantCatalogEntry[]>();
    // Mismo orden que ASSISTANT_CATALOG (ventas, caja, finanzas, inventario, equipo, suscripción): sin reordenar por azar.
    for (const entry of matching) byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry]);
    return [...byCategory.entries()];
  }, [entries, search, t]);

  if (periodFor) {
    const question = periodFor;
    return (
      <View style={{ gap: 14, padding: 16 }}>
        <AppText variant="heading">{t('assistant_choose_period')}</AppText>
        <AppText tone="muted">{t(`assistant_q_${question}`)}</AppText>
        <ChipRow>
          {REPORT_PERIODS.filter((period): period is Exclude<ReportPeriod, 'custom'> => period !== 'custom').map((period) => (
            <Chip key={period} label={t(`assistant_period_${period}`)} onPress={() => onPick(question, period)} />
          ))}
        </ChipRow>
        <Button label={t('cancel')} variant="ghost" onPress={() => setPeriodFor(null)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <AppText variant="heading" style={{ flex: 1 }} accessibilityRole="header">
          {t('assistant_catalog_title')}
        </AppText>
        <Button label={t('assistant_catalog_back')} variant="ghost" compact onPress={onClose} />
      </View>
      <Field label={t('assistant_catalog_search')} value={search} onChangeText={setSearch} autoCapitalize="none" />
      {failed ? (
        <AppText tone="danger" accessibilityRole="alert">
          {t('ai_error_general')}
        </AppText>
      ) : entries === null ? (
        <AppText tone="muted">{t('loading')}</AppText>
      ) : groups.length === 0 ? (
        <AppText tone="muted">{t('assistant_catalog_empty')}</AppText>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled">
          {groups.map(([category, qs]) => (
            <View key={category} style={{ marginBottom: 18, gap: 8 }}>
              <AppText variant="bodyStrong" tone="muted">
                {t(`assistant_cat_${category}`)}
              </AppText>
              <View style={{ gap: 4 }}>
                {qs.map((entry) => (
                  <Button
                    key={entry.question}
                    label={t(`assistant_q_${entry.question}`)}
                    variant="secondary"
                    onPress={() => (entry.needsPeriod ? setPeriodFor(entry.question) : onPick(entry.question))}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** Lista completa, sin agrupar — para pruebas o un futuro acceso directo (no se usa todavía en esta pantalla). */
export const ALL_ASSISTANT_QUESTIONS = ASSISTANT_CATALOG;
