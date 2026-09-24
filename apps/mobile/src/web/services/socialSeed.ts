import type { SocialProfile, SocialProvider } from './socialAuth.web';

/**
 * Datos que un proveedor (Google/Apple) entregó y que precargan el registro. Solo en memoria y de un solo uso:
 * nunca tokens, nunca almacenamiento del navegador.
 */
export interface SocialSeedData {
  provider: SocialProvider;
  profile: SocialProfile;
}

let seed: SocialSeedData | null = null;

export const setSocialSeed = (next: SocialSeedData) => {
  seed = next;
};

export function takeSocialSeed(): SocialSeedData | null {
  const value = seed;
  seed = null;
  return value;
}
