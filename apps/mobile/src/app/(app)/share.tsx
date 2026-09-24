import { formatMoney, normalizePhone, whatsappLink } from '@xiro/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { publicBaseUrl } from '@/lib/api';
import { useClients, useItem } from '@/lib/queries';
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
  const { t, colors } = useSettings();
  const { business } = useAuthed();
  const { mode, id } = useLocalSearchParams<{ mode?: 'catalog' | 'item'; id?: string }>();
  const item = useItem(mode === 'item' ? id : undefined).data;
  const clients = useClients().data ?? [];
  const [target, setTarget] = useState<Target>(clients.length > 0 ? 'client' : 'number');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string>();

  const client = clients.find((c) => c.id === pickedId);
  const base = `${publicBaseUrl()}/catalog/${business.slug}`;
  const greeting = target === 'client' && client ? `${t('hello')} ${client.name},` : `${t('hello')},`;

  const body =
    mode === 'item' && item
      ? t('share_message_item', { business: business.name, title: item.name, short: item.shortDescription, price: formatMoney(item.price, business.currency), url: `${base}/item/${item.id}` })
      : t('share_message_catalog', { business: business.name, url: base });
  const message = `${greeting} ${body}`;

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
          {clients.map((c) => {
            const selected = c.id === pickedId;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  setPickedId(c.id);
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
