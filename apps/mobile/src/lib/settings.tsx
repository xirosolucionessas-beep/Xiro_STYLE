import { LANGUAGES, THEMES, translate, type Language, type ThemeMode, type TranslationKey } from '@xiro/shared';
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { palettes, type Palette } from '@/ui/theme';
import { prefsStorage } from './storage';

const LANGUAGE_KEY = 'xiro.language';
const THEME_KEY = 'xiro.theme';
/** Botón flotante del asistente de IA (Ajustes): visible salvo que la persona lo apague. */
const AI_FAB_KEY = 'xiro.aiFab';
/** Botón flotante de contacto por WhatsApp (Ajustes, igual criterio que el del asistente): visible salvo que se apague. */
const WHATSAPP_FAB_KEY = 'xiro.whatsappFab';

function deviceLanguage(): Language {
  return getLocales()[0]?.languageCode === 'en' ? 'en' : 'es';
}

interface SettingsValue {
  language: Language;
  theme: ThemeMode;
  colors: Palette;
  ready: boolean;
  /** Mostrar el botón flotante del asistente de IA en Inicio. */
  aiFab: boolean;
  setAiFab: (visible: boolean) => void;
  /** Mostrar el botón flotante de contacto por WhatsApp (donde exista: hoy solo en la web). */
  whatsappFab: boolean;
  setWhatsappFab: (visible: boolean) => void;
  setLanguage: (language: Language) => void;
  setTheme: (theme: ThemeMode) => void;
  t: (key: TranslationKey | (string & {}), params?: Record<string, string | number>) => string;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(deviceLanguage);
  const [theme, setThemeState] = useState<ThemeMode>('dark');
  const [aiFab, setAiFabState] = useState(true);
  const [whatsappFab, setWhatsappFabState] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([prefsStorage.get(LANGUAGE_KEY), prefsStorage.get(THEME_KEY), prefsStorage.get(AI_FAB_KEY), prefsStorage.get(WHATSAPP_FAB_KEY)]).then(([storedLanguage, storedTheme, storedAiFab, storedWhatsappFab]) => {
      if (!active) return;
      if (LANGUAGES.includes(storedLanguage as Language)) setLanguageState(storedLanguage as Language);
      if (THEMES.includes(storedTheme as ThemeMode)) setThemeState(storedTheme as ThemeMode);
      if (storedAiFab === 'off') setAiFabState(false);
      if (storedWhatsappFab === 'off') setWhatsappFabState(false);
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

  const setAiFab = useCallback((visible: boolean) => {
    setAiFabState(visible);
    void prefsStorage.set(AI_FAB_KEY, visible ? 'on' : 'off');
  }, []);
  const setWhatsappFab = useCallback((visible: boolean) => {
    setWhatsappFabState(visible);
    void prefsStorage.set(WHATSAPP_FAB_KEY, visible ? 'on' : 'off');
  }, []);

  const value = useMemo<SettingsValue>(
    () => ({
      language,
      theme,
      colors: palettes[theme],
      ready,
      aiFab,
      setAiFab,
      whatsappFab,
      setWhatsappFab,
      setLanguage,
      setTheme,
      t: (key, params) => translate(language, key, params),
    }),
    [language, theme, ready, aiFab, setAiFab, whatsappFab, setWhatsappFab, setLanguage, setTheme],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings debe usarse dentro de SettingsProvider');
  return value;
}
