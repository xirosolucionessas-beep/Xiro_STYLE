import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { resolveMedia } from '@/lib/api';

const defaultLogo = require('../../assets/images/logo.png');

export function Brand({ size = 64, logoUrl }: { size?: number; logoUrl?: string | null }) {
  const remote = resolveMedia(logoUrl);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 4, overflow: 'hidden' }}>
      <Image source={remote ? { uri: remote } : defaultLogo} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Logo" />
    </View>
  );
}
