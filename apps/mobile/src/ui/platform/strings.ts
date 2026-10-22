import { useSettings } from '@/lib/settings';
import { textFor, type PlatformText } from './texts';

export * from './texts';

export function usePlatformText(): { pt: PlatformText; language: string } {
  const { language } = useSettings();
  return { pt: (key, vars) => textFor(language, key, vars), language };
}
