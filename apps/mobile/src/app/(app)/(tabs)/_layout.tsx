import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View } from 'react-native';
import { actorOf, meets, type Requirement } from '@/lib/access';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useLuxury } from '@/ui/luxuryTokens';

type IconName = keyof typeof Ionicons.glyphMap;

const tabs: Array<{ name: string; label: 'home' | 'inventory' | 'catalog' | 'clients' | 'more'; icon: IconName; active: IconName; requires?: Requirement }> = [
  { name: 'index', label: 'home', icon: 'home-outline', active: 'home' },
  { name: 'inventory', label: 'inventory', icon: 'cube-outline', active: 'cube', requires: ['catalog_view'] },
  { name: 'catalog', label: 'catalog', icon: 'book-outline', active: 'book', requires: ['catalog_view'] },
  { name: 'clients', label: 'clients', icon: 'people-outline', active: 'people', requires: ['clients_view'] },
  { name: 'more', label: 'more', icon: 'settings-outline', active: 'settings' },
];

export default function TabsLayout() {
  const { colors, t } = useSettings();
  const tk = useLuxury();
  const { user } = useSession();
  const actor = actorOf(user);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: tk.tabBorder,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          // Web: la navegación la da la barra lateral / drawer del shell (WebShell.web.tsx).
          ...(Platform.OS === 'web' ? { display: 'none' as const } : null),
        },
        // Fondo con leve degradado (barato en cualquier gama).
        tabBarBackground: () => <LinearGradient colors={tk.cardFill} style={StyleSheet.absoluteFill} />,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.background },
      }}>
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.label),
            // Sin permiso, la pestaña ni aparece (href: null la oculta de la barra y de la navegación).
            ...(meets(actor, tab.requires) ? null : { href: null }),
            tabBarIcon: ({ color, size, focused }) => (
              <View style={{ alignItems: 'center' }}>
                <Ionicons name={focused ? tab.active : tab.icon} size={size} color={color} />
                {/* Indicador dorado bajo la pestaña activa. */}
                <View style={{ height: 3, width: 22, borderRadius: 2, marginTop: 2, backgroundColor: focused ? colors.gold : 'transparent' }} />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
