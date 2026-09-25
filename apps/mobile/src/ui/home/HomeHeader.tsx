import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveMedia } from '@/lib/api';
import { badgeText } from '@/lib/alerts';
import { useSettings } from '@/lib/settings';
import { Brand } from '../Brand';
import { AppText } from '../Text';
import { useLuxury } from '../luxuryTokens';

interface Props {
  businessName: string;
  photoUrl?: string | null;
  greeting: string;
  tagline: string;
  slogan: string;
  pendingAlerts: number;
  onMenu: () => void;
  onBell: () => void;
}

const HERO_HEIGHT = 250;

/** Barra superior (menú · marca · campana) y saludo sobre la foto del negocio; sin foto, un degradado dorado. */
export function HomeHeader({ businessName, photoUrl, greeting, tagline, slogan, pendingAlerts, onMenu, onBell }: Props) {
  const { t } = useSettings();
  const tk = useLuxury();
  const insets = useSafeAreaInsets();
  const photo = resolveMedia(photoUrl);
  const text = photo ? tk.onHeroPhoto : tk.onHeroFallback;
  const muted = photo ? tk.onHeroPhotoMuted : tk.onHeroFallbackMuted;
  const badge = badgeText(pendingAlerts);

  return (
    <View style={{ height: HERO_HEIGHT + insets.top }}>
      {photo ? (
        <>
          <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
          <LinearGradient colors={tk.heroOverlay} locations={[0, 0.35, 0.75, 1]} style={StyleSheet.absoluteFill} />
        </>
      ) : (
        <LinearGradient colors={tk.heroFallback} style={StyleSheet.absoluteFill} />
      )}

      <View style={[styles.content, { paddingTop: insets.top + 6 }]}>
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('menu_open')} onPress={onMenu} hitSlop={6} style={styles.iconButton}>
            <Ionicons name="menu" size={30} color={text} />
          </Pressable>
          <View style={styles.brand} accessible accessibilityLabel={`Xiro Style. ${slogan}`}>
            <Brand size={38} />
            <AppText variant="small" style={{ color: muted, marginTop: 2 }}>
              {slogan}
            </AppText>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={pendingAlerts > 0 ? t('notif_bell_label', { n: pendingAlerts }) : t('notif_bell_none')} onPress={onBell} hitSlop={6} style={styles.iconButton}>
            <Ionicons name={pendingAlerts > 0 ? 'notifications' : 'notifications-outline'} size={26} color={text} />
            {badge ? (
              <View style={[styles.badge, { backgroundColor: tk.badge.urgent }]}>
                <AppText variant="small" style={styles.badgeText}>
                  {badge}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        </View>

        <View style={styles.greeting}>
          <AppText variant="title" style={{ color: text }}>
            {greeting}
          </AppText>
          <AppText variant="display" tone="gold" numberOfLines={2} ellipsizeMode="tail" style={[styles.name, photo ? { color: tk.heroAccentPhoto } : null]}>
            {businessName} 👋
          </AppText>
          <AppText style={{ color: muted, marginTop: 6, maxWidth: '72%' }}>{tagline}</AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 16, paddingBottom: 12, justifyContent: 'space-between' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  brand: { alignItems: 'center' },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontWeight: '800', fontSize: 11, lineHeight: 14 },
  greeting: { paddingBottom: 4 },
  name: { marginTop: 2 },
});
