/**
 * Logos oficiales de terceros para la app nativa (Nequi/Bancolombia): el mismo PNG entregado por el negocio que ya
 * usa la web (misma constante, sin duplicar el archivo), sobre una placa blanca redondeada para que se lean con
 * nitidez sobre el fondo oscuro. `Image` de React Native soporta URIs de datos igual que un navegador.
 */
import { Image, View, type ImageStyle } from 'react-native';
import { BANCOLOMBIA_LOGO_DATA_URI } from '../../brand/bancolombiaLogoData';
import { NEQUI_LOGO_DATA_URI } from '../../brand/nequiLogoData';

interface LogoProps {
  size?: number;
}

function Badge({ uri, size = 20 }: { uri: string; size?: number }) {
  const imageStyle: ImageStyle = { width: size * 0.78, height: size * 0.78 };
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <Image source={{ uri }} style={imageStyle} resizeMode="contain" />
    </View>
  );
}

export function NequiBadge({ size = 20 }: LogoProps) {
  return <Badge uri={NEQUI_LOGO_DATA_URI} size={size} />;
}

export function BancolombiaBadge({ size = 20 }: LogoProps) {
  return <Badge uri={BANCOLOMBIA_LOGO_DATA_URI} size={size} />;
}
