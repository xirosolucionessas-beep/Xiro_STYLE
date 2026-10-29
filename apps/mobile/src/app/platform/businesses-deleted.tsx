import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platformApi';
import { Card } from '@/ui/Kit';
import { Badge, formatDateTime, styles, Titled } from '@/ui/platform/parts';
import { errorText, usePlatformText } from '@/ui/platform/strings';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { Button } from '@/ui/Button';

/**
 * Negocios que su propio dueño eliminó para siempre (zona de peligro de /profile). El negocio ya no existe — todo
 * lo que se muestra sale de la bitácora de la plataforma (platform_audit_log), que sobrevive a esa eliminación a
 * propósito. Un campo ausente se muestra como "No disponible", nunca inventado.
 */
export default function PlatformDeletedBusinesses() {
  const { pt, language } = usePlatformText();
  const router = useRouter();
  const pages = useInfiniteQuery({
    queryKey: ['platform', 'businesses-deleted'],
    queryFn: ({ pageParam }) => platformApi.deletedBusinesses(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    retry: false,
  });
  const entries = pages.data?.pages.flatMap((p) => p.entries) ?? [];
  const notAvailable = pt('not_available');

  const roleLabel = (role: string | null) => (role === 'owner' ? pt('deleted_role_owner') : role === 'employee' ? pt('deleted_role_employee') : notAvailable);

  return (
    <Screen header={<Header title={pt('deleted_businesses_title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/platform'))} />}>
      <View style={{ gap: 12 }}>
        <Titled title={pt('deleted_businesses_title')} help={pt('deleted_businesses_help')} pt={pt} />
        {pages.isLoading ? <AppText tone="muted">{pt('loading')}</AppText> : null}
        {pages.error ? (
          <AppText tone="danger" accessibilityRole="alert">
            {errorText(pt, pages.error instanceof ApiError ? pages.error.code : undefined)}
          </AppText>
        ) : null}
        <Card style={{ gap: 4 }}>
          {!pages.isLoading && entries.length === 0 ? <AppText tone="muted">{pt('deleted_businesses_empty')}</AppText> : null}
          {entries.map((e) => (
            <View key={e.id} style={{ paddingVertical: 6, gap: 2 }}>
              <View style={styles.row}>
                <AppText variant="bodyStrong" style={styles.flex}>
                  {pt('deleted_business_label')}: {e.businessName ?? notAvailable}
                </AppText>
                <Badge label={pt(`outcome_${e.outcome}`)} tone={e.outcome === 'success' ? 'success' : 'danger'} />
              </View>
              <AppText variant="small" tone="muted">
                {formatDateTime(e.createdAt, language)}
              </AppText>
              <AppText variant="small" tone="muted">
                {pt('deleted_by_label')}: {e.requestedByName ?? notAvailable} ({roleLabel(e.requestedByRole)}){e.requestedByEmail ? ` · ${e.requestedByEmail}` : ''}
              </AppText>
            </View>
          ))}
        </Card>
        {pages.hasNextPage ? <Button label={pt('load_more')} variant="secondary" compact loading={pages.isFetchingNextPage} onPress={() => void pages.fetchNextPage()} /> : null}
      </View>
    </Screen>
  );
}
