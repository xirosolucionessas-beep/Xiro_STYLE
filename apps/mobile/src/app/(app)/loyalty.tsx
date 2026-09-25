import { LoyaltyPanel } from '@/ui/LoyaltyPanel';

/**
 * Fidelización en Android/iOS. En la Web esta ruta la sirve loyalty.web.tsx (su propio diseño): este archivo es la
 * versión nativa y, a la vez, el hermano sin extensión de plataforma que exige Expo Router.
 */
export default function Loyalty() {
  return <LoyaltyPanel />;
}
