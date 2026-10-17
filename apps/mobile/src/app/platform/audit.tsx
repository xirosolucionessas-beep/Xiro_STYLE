import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platformApi';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Kit';
import { formatDateTime } from '@/ui/platform/parts';
import { errorText, usePlatformText } from '@/ui/platform/strings';
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
      {pages.error ? <AppText tone="danger">{errorText(pt, pages.error instanceof ApiError ? pages.error.code : undefined)}</AppText> : null}
      <Card>
        {entries.map((e) => (
          <View key={e.id} style={{ paddingVertical: 4 }}>
            <AppText variant="small">
              {formatDateTime(e.createdAt, language)} · {e.action} · {e.outcome} · {e.adminName ?? '—'}
            </AppText>
            {e.businessId ? (
              <AppText variant="small" tone="gold" onPress={() => router.push(`/platform/business/${e.businessId}`)}>
                {e.businessId}
              </AppText>
            ) : null}
          </View>
        ))}
      </Card>
      {pages.hasNextPage ? <Button label={pt('load_more')} variant="secondary" compact loading={pages.isFetchingNextPage} onPress={() => void pages.fetchNextPage()} /> : null}
    </Screen>
  );
}
