/**
 * Sustituto SOLO WEB de `ActivityIndicator` para el código de src/ (lo enlaza metro.config.js).
 * En web una ruedita sola no dice qué se está cargando ni cómo será el contenido: se muestra un skeleton con la forma
 * aproximada de una lista/ficha y se anuncia UNA vez "Cargando" a los lectores de pantalla (role=status, aria-busy).
 */
import type { StyleProp, ViewStyle } from 'react-native';
import { useSettings } from '@/lib/settings';
import { rnStyleToCss } from '@/ui/rnStyle.web';
import { tw } from '@/web/shell/strings';
import { Skeleton, SkeletonGroup } from '@/web/ui';

interface Props {
  style?: StyleProp<ViewStyle>;
  /** Se ignoran: el skeleton usa los tokens del tema. */
  color?: string;
  size?: unknown;
  animating?: boolean;
}

export default function ActivityIndicator({ style }: Props) {
  const { language } = useSettings();
  return (
    <div style={{ width: '100%', ...rnStyleToCss(style) }}>
      <SkeletonGroup label={tw(language, 'loading')}>
        <Skeleton height={22} width="45%" />
        <Skeleton height={88} radius={16} />
        <Skeleton height={88} radius={16} />
        <Skeleton height={88} radius={16} />
      </SkeletonGroup>
    </div>
  );
}
