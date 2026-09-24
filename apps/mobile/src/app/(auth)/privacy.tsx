import { Redirect } from 'expo-router';

/**
 * Fallback nativo de /privacy (exigido por Expo Router: todo "*.web.tsx" necesita un hermano sin extensión de
 * plataforma). La app móvil aún no separa Términos de Privacidad — su pantalla /terms ya cubre ambos temas con
 * el texto compartido (terms_title/terms_body). Nunca se navega aquí desde la UI nativa.
 */
export default function PrivacyFallback() {
  return <Redirect href="/terms" />;
}
