import { LANGUAGES, THEMES, translate, type Language, type ThemeMode, type TranslationKey } from '@xiro/shared';
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { palettes, type Palette } from '@/ui/theme';
import { prefsStorage } from './storage';

const LANGUAGE_KEY = 'xiro.language';
const THEME_KEY = 'xiro.theme';

function deviceLanguage(): Language {
  return getLocales()[0]?.languageCode === 'en' ? 'en' : 'es';
}

interface SettingsValue {
  language: Language;
  theme: ThemeMode;
  colors: Palette;
  ready: boolean;
  setLanguage: (language: Language) => void;
  setTheme: (theme: ThemeMode) => void;
  t: (key: TranslationKey | (string & {}), params?: Record<string, string | number>) => string;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(deviceLanguage);
  const [theme, setThemeState] = useState<ThemeMode>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([prefsStorage.get(LANGUAGE_KEY), prefsStorage.get(THEME_KEY)]).then(([storedLanguage, storedTheme]) => {
      if (!active) return;
      if (LANGUAGES.includes(storedLanguage as Language)) setLanguageState(storedLanguage as Language);
      if (THEMES.includes(storedTheme as ThemeMode)) setThemeState(storedTheme as ThemeMode);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    void prefsStorage.set(LANGUAGE_KEY, next);
  }, []);
  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    void prefsStorage.set(THEME_KEY, next);
  }, []);

  const value = useMemo<SettingsValue>(
    () => ({
      language,
      theme,
      colors: palettes[theme],
      ready,
      setLanguage,
      setTheme,
      t: (key, params) => translate(language, key, params),
    }),
    [language, theme, ready, setLanguage, setTheme],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings debe usarse dentro de SettingsProvider');
  return value;
}
