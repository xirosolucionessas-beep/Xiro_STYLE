import { buildItemShareText, normalizePhone, whatsappLink, type Client } from '@xiro/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { publicBaseUrl, publicItemUrl } from '@/lib/api';
import { useClientSearch, useItem } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Card, Chip } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius } from '@/ui/theme';

type Target = 'client' | 'number' | 'any';

export default function Share() {
  const { t, colors, language } = useSettings();
  const { business } = useAuthed();
  const { mode, id } = useLocalSearchParams<{ mode?: 'catalog' | 'item'; id?: string }>();
  const item = useItem(mode === 'item' ? id : undefined).data;
  // Selector de cliente con búsqueda en el servidor (20 resultados): no se descarga el directorio completo.
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setApplied(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const clients = useClientSearch(applied).data?.data ?? [];
  const [target, setTarget] = useState<Target>(clients.length > 0 ? 'client' : 'number');
  // Se guarda el cliente elegido (no solo su id): sigue elegido aunque cambie la búsqueda.
  const [client, setClient] = useState<Client | null>(null);
  const pickedId = client?.id ?? null;
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string>();

  const base = `${publicBaseUrl()}/catalog/${business.slug}`;
  const greeting = target === 'client' && client ? `${t('hello')} ${client.name},` : `${t('hello')},`;

  // Un artículo: mensaje distinto para producto (consulta) y servicio (reserva), con la dirección canónica del artículo.
  const message =
    mode === 'item' && item
      ? `${greeting}

${buildItemShareText(item, { businessName: business.name, publicUrl: publicItemUrl(business.slug, item.id), currency: business.currency, language })}`
      : `${greeting} ${t('share_message_catalog', { business: business.name, url: base })}`;

  function open() {
    let phone = '';
    if (target === 'client') {
      phone = client?.phone ?? '';
      if (!phone) return setError(t('share_no_phone'));
    } else if (target === 'number') {
      phone = normalizePhone(number) ?? '';
      if (!phone) return setError(t('phone_invalid'));
    }
    setError(undefined);
    void Linking.openURL(whatsappLink(phone, message));
  }

  return (
    <Screen header={<Header title={t('share_whatsapp')} subtitle={t('share_hint')} />} footer={<Button label={t('share_open')} icon="logo-whatsapp" onPress={open} disabled={mode === 'item' && !item} />}>
      <View style={styles.chips} role="radiogroup" aria-label={t('share_recipient')}>
        <Chip label={t('share_client')} selected={target === 'client'} onPress={() => setTarget('client')} />
        <Chip label={t('share_other')} selected={target === 'number'} onPress={() => setTarget('number')} />
        <Chip label="WhatsApp" selected={target === 'any'} onPress={() => setTarget('any')} />
      </View>

      {target === 'number' ? (
        <Field label={t('phone')} value={number} onChangeText={setNumber} keyboardType="phone-pad" prefix="+57" error={error} />
      ) : target === 'client' ? (
        <View style={{ gap: 8 }} role="radiogroup" aria-label={t('share_client')}>
          <Field label={t('search')} value={search} onChangeText={setSearch} autoCapitalize="none" />
          {clients.map((c) => {
            const selected = c.id === pickedId;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  setClient(c);
                  setError(undefined);
                }}
                style={[styles.client, { borderColor: selected ? colors.gold : colors.border, backgroundColor: selected ? colors.goldTint : colors.surface }]}>
                <AppText tone="gold" variant="heading">
                  {selected ? '✓' : '○'}
                </AppText>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">{c.name}</AppText>
                  <AppText variant="small" tone="muted">
                    {c.phone ? `+${c.phone}` : t('share_no_phone')}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
          {clients.length === 0 ? <AppText tone="muted">{t('no_clients')}</AppText> : null}
          {error ? (
            <AppText tone="danger" variant="small">
              {error}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <Card style={{ marginTop: 20 }}>
        <AppText variant="label" tone="gold" style={{ marginBottom: 6 }}>
          WhatsApp
        </AppText>
        <AppText tone="muted">{message}</AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  client: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: radius.md, padding: 12 },
});
