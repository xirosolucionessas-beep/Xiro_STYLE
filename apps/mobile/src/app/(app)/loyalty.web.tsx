/**
 * Ruta /loyalty SOLO WEB (fallback nativo: loyalty.tsx, redirige a /more — no existe pantalla nativa de
 * fidelización, ver resumen de la Fase 2). Configuración del programa, progreso por cliente y canjes.
 * Presentación en src/web/screens/Loyalty.tsx.
 */
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useInvalidateLoyalty, useItems, useLoyaltyClients, useLoyaltyProgram, useLoyaltyRedemptions } from '@/lib/queries';
import { actorOf, meets } from '@/lib/access';
import { useAuthed } from '@/lib/session';
import { LoyaltyView } from '@/web/screens/Loyalty';
import { useWebText } from '@/web/services/useWebText';

export default function LoyaltyWeb() {
  const { t } = useWebText();
  const { user, business } = useAuthed();
  const canRedeem = meets(actorOf(user), ['loyalty_redeem']);
  const program = useLoyaltyProgram();
  const items = useItems();
  const clients = useLoyaltyClients();
  const redemptions = useLoyaltyRedemptions(undefined, canRedeem);
  const invalidateLoyalty = useInvalidateLoyalty();

  if (!program.data) return null;

  async function saveProgram(input: { enabled: boolean; goal: number; resetOnRedeem: boolean; rewardMessage: string; itemIds: string[] }) {
    try {
      await api.updateLoyaltyProgram(input);
      await invalidateLoyalty();
      return { ok: true as const };
    } catch (error) {
      const result = apiErrors(error, t);
      return { ok: false as const, error: result.fields.goal ?? result.fields.rewardMessage ?? result.general ?? t('unknown_error') };
    }
  }

  async function recordService(input: { clientId: string; itemId: string; amount?: number; note: string }) {
    try {
      const record = await api.createServiceRecord(input);
      await invalidateLoyalty();
      return { ok: true as const, rewardJustEarned: record.rewardJustEarned };
    } catch (error) {
      const result = apiErrors(error, t);
      return { ok: false as const, error: result.general ?? Object.values(result.fields)[0] ?? t('unknown_error') };
    }
  }

  async function redeem(clientId: string) {
    try {
      await api.redeemLoyalty(clientId);
      await invalidateLoyalty();
      return { ok: true as const };
    } catch (error) {
      const result = apiErrors(error, t);
      return { ok: false as const, error: result.general ?? t('unknown_error') };
    }
  }

  return (
    <LoyaltyView
      t={t}
      currency={business.currency}
      businessName={business.name}
      program={program.data}
      items={items.data ?? []}
      clientsProgress={clients.data ?? []}
      redemptions={redemptions.data ?? []}
      onSaveProgram={saveProgram}
      onRecordService={recordService}
      onRedeem={redeem}
      canConfigure={user.role === 'owner'}
      canRedeem={canRedeem}
    />
  );
}
