/**
 * Sustituto SOLO WEB de `Pressable` para el código de src/ (lo enlaza metro.config.js). Es el mismo Pressable de
 * react-native-web, pero traduce `accessibilityState` a atributos ARIA para que los lectores de pantalla
 * conozcan el estado de radios, casillas e interruptores.
 */
import { forwardRef } from 'react';
import type { PressableProps, View } from 'react-native';
import WebPressable from 'react-native-web/dist/exports/Pressable';
import { adaptAccessibilityState } from './accessibilityState';

const Pressable = forwardRef<View, PressableProps>(function Pressable(props, ref) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <WebPressable ref={ref} {...adaptAccessibilityState(props as any)} />;
});

export default Pressable;
