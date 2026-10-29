import { useInfiniteQuery } from '@tanstack/react-query';
import { PLATFORM_BUSINESS_SORTS, type PlatformBusinessSort } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platformApi';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Card, Photo } from '@/ui/Kit';
import { AccessBadge, formatDateTime, Segmented, styles, Titled } from '@/ui/platform/parts';
import { errorText, usePlatformText } from '@/ui/platform/strings';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

const PAGE_SIZE = 25;

/**
 * "Ver más" de Negocios registrados: listado paginado en el servidor (GET /api/platform/businesses), con búsqueda
 * (nombre, correo del dueño o identificador) y orden. Abrir cualquier página queda en la bitácora.
 */
export default function PlatformBusinessList() {
  const { pt, language } = usePlatformText();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<PlatformBusinessSort>('created_desc');

  const pages = useInfiniteQuery({
    queryKey: ['platform', 'businesses', q, sort],
    queryFn: ({ pageParam }) => platformApi.businesses({ q: q || undefined, sort, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    retry: false,
  });
  const results = pages.data?.pages.flatMap((p) => p.results) ?? [];
  const total = pages.data?.pages.at(-1)?.total ?? 0;
  const runSearch = () => setQ(input.trim());

  return (
    <Screen header={<Header title={pt('businesses_list_title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/platform'))} />}>
      <View style={{ gap: 12 }}>
        <Titled title={pt('businesses_list_title')} help={pt('businesses_list_help')} pt={pt} />

        <Card style={{ gap: 10 }}>
          <Field label={pt('businesses_list_search_placeholder')} value={input} onChangeText={setInput} autoCapitalize="none" onSubmitEditing={runSearch} />
          <Button label={pt('search')} icon="search" compact onPress={runSearch} />
          <View style={{ gap: 4 }}>
            <AppText variant="label" tone="muted">
              {pt('sort_label')}
            </AppText>
            <Segmented label={pt('sort_label')} options={PLATFORM_BUSINESS_SORTS.map((s) => ({ value: s, label: pt(`sort_${s}`) }))} value={sort} onChange={setSort} />
          </View>
        </Card>

        {pages.isLoading ? <AppText tone="muted">{pt('loading')}</AppText> : null}
        {pages.error ? (
          <AppText tone="danger" accessibilityRole="alert">
            {errorText(pt, pages.error instanceof ApiError ? pages.error.code : undefined)}
          </AppText>
        ) : null}
        {!pages.isLoading && !pages.error && results.length === 0 ? <AppText tone="muted">{pt('businesses_list_empty')}</AppText> : null}

        {results.length > 0 ? (
          <View style={{ gap: 6 }}>
            {results.map((b) => (
              <Card key={b.id} onPress={() => router.push(`/platform/business/${b.id}`)}>
                <View style={[styles.row, { alignItems: 'flex-start' }]}>
                  <Photo url={b.logoUrl} size={44} initials={b.name} icon="storefront-outline" />
                  <View style={[styles.flex, { gap: 2 }]}>
                    <View style={styles.row}>
                      <AppText variant="bodyStrong" style={styles.flex}>
                        {b.name}
                      </AppText>
                      <AccessBadge status={b.accessStatus} pt={pt} />
                    </View>
                    <AppText variant="small" tone="muted">
                      {pt('owner_email')}: {b.ownerEmailMasked ?? pt('owner_email_unknown')}
                    </AppText>
                    <AppText variant="small" tone="muted">
                      {pt('search_kind_slug')}: {b.slug} · {pt('created')}: {formatDateTime(b.createdAt, language)}
                    </AppText>
                  </View>
                </View>
              </Card>
            ))}
            <AppText variant="small" tone="muted">
              {pt('results_shown', { shown: results.length, total })}
            </AppText>
          </View>
        ) : null}

        {pages.hasNextPage ? <Button label={pt('load_more')} variant="secondary" compact loading={pages.isFetchingNextPage} onPress={() => void pages.fetchNextPage()} /> : null}
      </View>
    </Screen>
  );
}
