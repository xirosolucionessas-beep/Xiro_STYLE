// Punto de partida para src/theme/tokens.ts. Adaptar a la estructura existente del proyecto.
export const palette = {
  dark: {
    bg: '#151311', surface: '#1D1A17', raised: '#26221E', line: '#38322B',
    text: '#EDE7DB', muted: '#A39A8B',
    accent: '#C6A25A', onAccent: '#1A1610', accentText: '#C6A25A',
    success: '#6BAA7F', warning: '#E58A52', danger: '#E0705D', info: '#7E9DB8',
  },
  light: {
    bg: '#F5F1E9', surface: '#FFFFFF', raised: '#FBF8F2', line: '#E1D9CA',
    text: '#1E1A15', muted: '#6A6154',
    accent: '#C6A25A', onAccent: '#1A1610', accentText: '#7A5C1B',
    success: '#2F7A4B', warning: '#9A4E1C', danger: '#B3402F', info: '#3E6786',
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radii = { control: 8, container: 12, sheet: 16, round: 999 } as const;

export const fonts = {
  body: 'IBMPlexSans_400Regular',
  bodyMedium: 'IBMPlexSans_500Medium',
  bodySemi: 'IBMPlexSans_600SemiBold',
  heading: 'IBMPlexSansCondensed_600SemiBold',
  headingBold: 'IBMPlexSansCondensed_700Bold',
} as const;

export const type = {
  caption: { fontSize: 12, lineHeight: 16 },
  body: { fontSize: 14, lineHeight: 20 },
  bodyLarge: { fontSize: 16, lineHeight: 24 },
  title: { fontSize: 20, lineHeight: 26 },
  headline: { fontSize: 24, lineHeight: 30 },
  display: { fontSize: 32, lineHeight: 38 },
  money: { fontVariant: ['tabular-nums'] as const },
} as const;

export const layout = { pageMaxWidth: 1160, minTouch: 44 } as const;
