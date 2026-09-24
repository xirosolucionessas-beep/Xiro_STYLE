import type { CSSProperties } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

const px = (value: unknown) => (typeof value === 'number' ? `${value}px` : (value as string));

/**
 * Traduce el subconjunto de estilos de layout de React Native que las pantallas pasan a los botones
 * (márgenes, flex, ancho…) a CSS. Solo web. Colores y tipografía NO se traducen: salen de los tokens.
 */
export function rnStyleToCss(style: StyleProp<ViewStyle>): CSSProperties | undefined {
  const flat = StyleSheet.flatten(style) as Record<string, unknown> | undefined;
  if (!flat) return undefined;
  const css: Record<string, string | number> = {};
  const copy = (from: string, to = from) => {
    if (flat[from] !== undefined) css[to] = px(flat[from]);
  };

  for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
    copy(`margin${side}`);
    copy(`padding${side}`);
  }
  copy('margin');
  copy('padding');
  if (flat.marginHorizontal !== undefined) css.marginLeft = css.marginRight = px(flat.marginHorizontal);
  if (flat.marginVertical !== undefined) css.marginTop = css.marginBottom = px(flat.marginVertical);
  if (flat.paddingHorizontal !== undefined) css.paddingLeft = css.paddingRight = px(flat.paddingHorizontal);
  if (flat.paddingVertical !== undefined) css.paddingTop = css.paddingBottom = px(flat.paddingVertical);
  for (const key of ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'alignSelf', 'flexGrow', 'flexShrink', 'opacity']) copy(key);
  if (typeof flat.flex === 'number') css.flex = flat.flex > 0 ? `${flat.flex} 1 0%` : flat.flex === 0 ? '0 0 auto' : '0 1 auto';

  return Object.keys(css).length > 0 ? (css as CSSProperties) : undefined;
}
