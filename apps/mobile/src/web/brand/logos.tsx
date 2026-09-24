/**
 * Logos de marca de terceros, como componentes SVG/imagen locales (nunca desde una URL externa, nunca redibujados
 * a mano cuando hay un archivo oficial). NO son iconos de línea: conservan proporciones y colores oficiales.
 * Google: "G" multicolor · Apple: manzana en el color del texto del botón (negro sobre blanco / blanco sobre
 * negro; jamás dorada) · WhatsApp: verde #25D366 o blanco · Nequi/Bancolombia: PNG oficial entregado por el
 * negocio (nequiLogoData.ts / bancolombiaLogoData.ts), embebido como data URI, sobre una placa blanca redondeada
 * para que se lean con nitidez sobre el fondo oscuro. Las demás rutas son las geometrías públicas de cada marca;
 * contrástalas con los recursos oficiales si tu equipo legal lo exige.
 */
import { BANCOLOMBIA_LOGO_DATA_URI } from './bancolombiaLogoData';
import { NEQUI_LOGO_DATA_URI } from './nequiLogoData';

interface LogoProps {
  size?: number;
}

export function GoogleLogo({ size = 20 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Usa `currentColor`: el botón decide negro o blanco según el tema (regla de Sign in with Apple). */
export function AppleLogo({ size = 20 }: LogoProps) {
  return (
    <svg width={size * (814 / 1000)} height={size} viewBox="0 0 814 1000" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

/** Insignia compacta en el azul oficial de PayPal (#003087) con una "P" — simplificación legible a tamaño de ícono, no un trazo del logotipo. */
export function PaypalLogo({ size = 20 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="6" fill="#003087" />
      <text x="12" y="17.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontStyle="italic" fontSize="14" fill="#fff">
        P
      </text>
    </svg>
  );
}

/** Logo oficial de Nequi (archivo entregado por el negocio) sobre una placa blanca redondeada, para contraste sobre fondo oscuro. */
export function NequiBadge({ size = 20 }: LogoProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, flex: 'none', borderRadius: '50%', background: '#fff', overflow: 'hidden' }}>
      <img src={NEQUI_LOGO_DATA_URI} alt="" aria-hidden="true" width={size * 0.78} height={size * 0.78} style={{ objectFit: 'contain' }} />
    </span>
  );
}

/** Logo oficial de Bancolombia (archivo entregado por el negocio) sobre una placa blanca redondeada, para contraste sobre fondo oscuro. */
export function BancolombiaBadge({ size = 20 }: LogoProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, flex: 'none', borderRadius: '50%', background: '#fff', overflow: 'hidden' }}>
      <img src={BANCOLOMBIA_LOGO_DATA_URI} alt="" aria-hidden="true" width={size * 0.78} height={size * 0.78} style={{ objectFit: 'contain' }} />
    </span>
  );
}

/** `tone="brand"` = verde oficial sobre fondo claro/oscuro · `tone="white"` = blanco (sobre el botón verde). */
export function WhatsAppLogo({ size = 20, tone = 'brand' }: LogoProps & { tone?: 'brand' | 'white' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill={tone === 'white' ? '#FFFFFF' : '#25D366'}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
