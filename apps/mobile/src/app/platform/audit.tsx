import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platformApi';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Kit';
import { Badge, formatDateTime, styles, Titled } from '@/ui/platform/parts';
import { auditActionText, errorText, usePlatformText } from '@/ui/platform/strings';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

/** Bitácora de la plataforma, 50 por página (paginada en el servidor). Leerla también queda registrado. */
export default function PlatformAudit() {
  const { pt, language } = usePlatformText();
  const router = useRouter();
  const pages = useInfiniteQuery({
    queryKey: ['platform', 'audit'],
    queryFn: ({ pageParam }) => platformApi.audit(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    retry: false,
  });
  const entries = pages.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <Screen header={<Header title={pt('audit_title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/platform'))} />}>
      <View style={{ gap: 12 }}>
        <Titled title={pt('audit_title')} help={pt('audit_help')} pt={pt} />
        {pages.isLoading ? <AppText tone="muted">{pt('loading')}</AppText> : null}
        {pages.error ? (
          <AppText tone="danger" accessibilityRole="alert">
            {errorText(pt, pages.error instanceof ApiError ? pages.error.code : undefined)}
          </AppText>
        ) : null}
        <Card style={{ gap: 4 }}>
          {!pages.isLoading && entries.length === 0 ? <AppText tone="muted">{pt('audit_empty')}</AppText> : null}
          {entries.map((e) => (
            <View key={e.id} style={{ paddingVertical: 6, gap: 2 }}>
              <View style={styles.row}>
                <AppText variant="bodyStrong" style={styles.flex}>
                  {auditActionText(pt, e.action)}
                </AppText>
                <Badge label={pt(`outcome_${e.outcome}`)} tone={e.outcome === 'success' ? 'success' : e.outcome === 'denied' ? 'warning' : 'danger'} />
              </View>
              <AppText variant="small" tone="muted">
                {formatDateTime(e.createdAt, language)} · {pt('audit_by')} {e.action.startsWith('cli.') ? pt('audit_system') : (e.adminName ?? pt('audit_unknown_admin'))}
              </AppText>
              {typeof e.details.reason === 'string' ? (
                <AppText variant="small" tone="muted">
                  {pt('audit_reason')}: {e.details.reason}
                </AppText>
              ) : null}
              {e.businessId ? (
                <AppText variant="small" tone="gold" accessibilityRole="link" onPress={() => router.push(`/platform/business/${e.businessId}`)}>
                  {pt('audit_business')}: {typeof e.details.businessName === 'string' ? e.details.businessName : pt('new_open_business')}
                </AppText>
              ) : null}
            </View>
          ))}
        </Card>
        {pages.hasNextPage ? <Button label={pt('load_more')} variant="secondary" compact loading={pages.isFetchingNextPage} onPress={() => void pages.fetchNextPage()} /> : null}
      </View>
    </Screen>
  );
}
