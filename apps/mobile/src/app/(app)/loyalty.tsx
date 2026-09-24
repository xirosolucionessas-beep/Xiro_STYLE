import { Redirect } from 'expo-router';

/**
 * Fallback nativo de /loyalty (exigido por Expo Router: todo "*.web.tsx" necesita un hermano sin extensión de
 * plataforma). La fidelización aún no tiene pantalla nativa (Fase 2 se limitó a la Web, ver resumen de fase).
 * Nunca se navega aquí desde la UI nativa.
 */
export default function LoyaltyFallback() {
  return <Redirect href="/more" />;
}
