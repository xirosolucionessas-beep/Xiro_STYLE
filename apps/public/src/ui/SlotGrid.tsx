import { formatClock, translate, type AvailabilitySlot, type Language } from '@xiro/shared';

interface SlotGridProps {
  slots: AvailabilitySlot[];
  value: string | null;
  onChange: (slot: AvailabilitySlot) => void;
  language: Language;
}

/** Cuadrícula de horarios de un día: libre, ocupado o no disponible. El estado va en el texto, nunca solo en el color. */
export function SlotGrid({ slots, value, onChange, language }: SlotGridProps) {
  const t = (key: string) => translate(language, key);
  return (
    <div className="xp-slots" role="radiogroup" aria-label={t('pub_schedule_step_title')}>
      {slots.map((slot) => {
        const selected = value === slot.startsAt;
        const free = slot.state === 'available';
        const clock = formatClock(slot.time, language);
        const stateLabel = t(`pub_slot_${slot.state}`);
        return (
          <button
            key={slot.startsAt}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={free ? clock : `${clock}, ${stateLabel}`}
            disabled={!free}
            onClick={() => onChange(slot)}
            className="xp-slot">
            {clock}
            {!free ? <span className="xp-slot-state">{stateLabel}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
