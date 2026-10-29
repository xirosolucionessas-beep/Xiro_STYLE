import { REPORT_PERIODS, type AssistantCatalogEntry, type AssistantCategory, type AssistantQuestionKey, type ReportPeriod } from '@xiro/shared';
import { useEffect, useMemo, useState } from 'react';
import { useWebStyles } from './shared';

type T = (key: string) => string;

/**
 * "Ver todas las preguntas" (sección 1 de la propuesta de diseño): categorías, buscador y, si la pregunta lo exige,
 * un período antes de ejecutarla. Al elegir, `onPick` corre la pregunta y el resultado llega como un mensaje más del
 * chat — esta vista es solo OTRA forma de producir esa misma pregunta, no cambia cómo se muestran las respuestas.
 * `fetchCatalog` llega como prop (no importa `lib/api` aquí) para poder probar este componente sin cargar React
 * Native (ver vitest.config.mts) y para que `AssistantPanel` sea quien decide de dónde sale el catálogo real.
 */
export function AssistantCatalog({ t, fetchCatalog, onPick }: { t: T; fetchCatalog: () => Promise<AssistantCatalogEntry[]>; onPick: (question: AssistantQuestionKey, period?: ReportPeriod) => void }) {
  useWebStyles();
  const [entries, setEntries] = useState<AssistantCatalogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [periodFor, setPeriodFor] = useState<AssistantQuestionKey | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCatalog()
      .then((rows) => alive && setEntries(rows))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [fetchCatalog]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = (entries ?? []).filter((e) => !q || t(`assistant_q_${e.question}`).toLowerCase().includes(q));
    const byCategory = new Map<AssistantCategory, AssistantCatalogEntry[]>();
    // Mismo orden que ASSISTANT_CATALOG: sin reordenar por azar.
    for (const entry of matching) byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry]);
    return [...byCategory.entries()];
  }, [entries, search, t]);

  if (periodFor) {
    const question = periodFor;
    return (
      <div className="xw-asst-catalog">
        <p className="xw-asst-cat-group-title">{t(`assistant_q_${question}`)}</p>
        <p>{t('assistant_choose_period')}</p>
        <div className="xw-asst-period-row">
          {REPORT_PERIODS.filter((period): period is Exclude<ReportPeriod, 'custom'> => period !== 'custom').map((period) => (
            <button key={period} type="button" className="xw-asst-period-chip" onClick={() => onPick(question, period)}>
              {t(`assistant_period_${period}`)}
            </button>
          ))}
        </div>
        <button type="button" className="xw-link-btn" onClick={() => setPeriodFor(null)}>
          {t('cancel')}
        </button>
      </div>
    );
  }

  return (
    <div className="xw-asst-catalog">
      <input
        className="xw-asst-cat-search"
        type="search"
        placeholder={t('assistant_catalog_search')}
        aria-label={t('assistant_catalog_search')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {failed ? (
        <p role="alert">{t('ai_error_general')}</p>
      ) : entries === null ? (
        <p>{t('loading')}</p>
      ) : groups.length === 0 ? (
        <p>{t('assistant_catalog_empty')}</p>
      ) : (
        groups.map(([category, questions]) => (
          <div className="xw-asst-cat-group" key={category}>
            <p className="xw-asst-cat-group-title">{t(`assistant_cat_${category}`)}</p>
            {questions.map((entry) => (
              <button key={entry.question} type="button" className="xw-asst-cat-btn" onClick={() => (entry.needsPeriod ? setPeriodFor(entry.question) : onPick(entry.question))}>
                {t(`assistant_q_${entry.question}`)}
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
