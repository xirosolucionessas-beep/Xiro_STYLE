import { translate, type Language } from '@xiro/shared';
import { Icon } from '../ui/Icon';

export type StepId = 'services' | 'professional' | 'schedule' | 'details' | 'review';

/**
 * Indicador de progreso con nombre de cada paso. En pantallas angostas solo el paso actual muestra su nombre (los demás son
 * círculos numerados/con check) y debajo va siempre la frase "Paso 2 de 5 · Profesional". Los pasos ya hechos se pueden tocar
 * para volver a ellos sin perder lo elegido.
 */
export function Stepper({ steps, current, language, onGo }: { steps: StepId[]; current: number; language: Language; onGo: (index: number) => void }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const name = (id: StepId) => t(`pub_step_${id}`);
  return (
    <div className="xp-stepper-wrap">
      <ol className="xp-stepper">
        {steps.map((id, index) => {
          const done = index < current;
          const isCurrent = index === current;
          return (
            <li key={id} className={`xp-stepper-item${done ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`} aria-current={isCurrent ? 'step' : undefined}>
              <button type="button" className="xp-stepper-btn" disabled={!done} onClick={() => onGo(index)} aria-label={`${index + 1}. ${name(id)}`}>
                <span className="xp-stepper-dot" aria-hidden="true">
                  {done ? <Icon name="check" size={14} /> : index + 1}
                </span>
                <span className="xp-stepper-label">{name(id)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="xp-stepper-text" role="status">
        {t('pub_step_progress', { step: current + 1, total: steps.length, name: name(steps[current]!) })}
      </p>
    </div>
  );
}
