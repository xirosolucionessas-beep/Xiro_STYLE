// react-native-web no publica tipos: se usan los de react-native (misma API).
declare module 'react-native-web/dist/exports/Pressable' {
  import type { Pressable } from 'react-native';
  const WebPressable: typeof Pressable;
  export default WebPressable;
}
