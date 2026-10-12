/**
 * Ruta /loyalty SOLO WEB (fallback nativo: loyalty.tsx, redirige a /more — no existe pantalla nativa de
 * fidelización, ver resumen de la Fase 2). Configuración del programa, progreso por cliente y canjes.
 * Presentación en src/web/screens/Loyalty.tsx.
 */
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { errorKey } from '@/lib/api';
import { flatPages, useAllItems, useInvalidateLoyalty, useLoyaltyClients, useLoyaltyProgram, useLoyaltyRedemptions, useLoyaltySummary } from '@/lib/queries';
import { actorOf, meets } from '@/lib/access';
import { useAuthed } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { LoyaltyView } from '@/web/screens/Loyalty';
import { useWebText } from '@/web/services/useWebText';

export default function LoyaltyWeb() {
  const { t } = useWebText();
  const { user, business } = useAuthed();
  const canRedeem = meets(actorOf(user), ['loyalty_redeem']);
  const program = useLoyaltyProgram();
  // Configuración y registro de servicios: catálogo completo. Progreso e historial: paginados; indicadores del servidor.
  const items = useAllItems();
  const clients = useLoyaltyClients();
  const summary = useLoyaltySummary();
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
    <Screen header={<Header root title={t('loyalty_title')} subtitle={t('loyalty_subtitle')} />}>
    <LoyaltyView
      t={t}
      currency={business.currency}
      businessName={business.name}
      program={program.data}
      items={items.data ?? []}
      clientsProgress={flatPages(clients.data)}
      redemptions={flatPages(redemptions.data)}
      summary={summary.data}
      clientsPagination={{ hasMore: Boolean(clients.hasNextPage), loading: clients.isFetchingNextPage, error: clients.isFetchNextPageError ? t(errorKey(clients.error)) : undefined, onLoadMore: () => void clients.fetchNextPage() }}
      redemptionsPagination={{ hasMore: Boolean(redemptions.hasNextPage), loading: redemptions.isFetchingNextPage, error: redemptions.isFetchNextPageError ? t(errorKey(redemptions.error)) : undefined, onLoadMore: () => void redemptions.fetchNextPage() }}
      onSaveProgram={saveProgram}
      onRecordService={recordService}
      onRedeem={redeem}
      canConfigure={user.role === 'owner'}
      canRedeem={canRedeem}
    />
    </Screen>
  );
}
