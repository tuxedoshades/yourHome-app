import * as SecureStore from "../storage/secureStore";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  LANGUAGE_OPTIONS,
  LANGUAGE_STORE_KEY,
  DEFAULT_LANGUAGE,
  getLanguageOption,
  isSupportedLanguage,
  type AppLanguage,
} from "./config";
import { dictionaries } from "./dictionaries";
import { useAuth } from "../auth/session";

type TranslateValues = Record<string, string | number | null | undefined>;

type I18nContextValue = {
  language: AppLanguage;
  languageOptions: typeof LANGUAGE_OPTIONS;
  setLanguage: (next: AppLanguage) => Promise<void>;
  t: (key: string, values?: TranslateValues) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, values?: TranslateValues) {
  if (!values) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => String(values[key] ?? ""));
}

export function I18nProvider({ children }: PropsWithChildren) {
  const { isAuthenticated, user, updateLanguagePreference } = useAuth();
  const [language, setLanguageState] = useState<AppLanguage>(DEFAULT_LANGUAGE);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(LANGUAGE_STORE_KEY);
        if (!active || !isSupportedLanguage(stored)) return;
        setLanguageState(stored);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const preferred = user?.preferredLanguage;
    if (!isSupportedLanguage(preferred)) return;
    setLanguageState((current) => (current === preferred ? current : preferred));
    void SecureStore.setItemAsync(LANGUAGE_STORE_KEY, preferred).catch(() => undefined);
  }, [user?.preferredLanguage]);

  const persistLanguage = useCallback(async (next: AppLanguage) => {
    setLanguageState(next);
    await SecureStore.setItemAsync(LANGUAGE_STORE_KEY, next);
  }, []);

  const setLanguage = useCallback(
    async (next: AppLanguage) => {
      await persistLanguage(next);
      if (isAuthenticated) {
        try {
          await updateLanguagePreference(next);
        } catch {
          // local preference still wins until backend sync succeeds later
        }
      }
    },
    [isAuthenticated, persistLanguage, updateLanguagePreference],
  );

  useEffect(() => {
    if (!hydratedRef.current || !isAuthenticated || !isSupportedLanguage(language)) return;
    if (user?.preferredLanguage === language) return;
    void updateLanguagePreference(language).catch(() => undefined);
  }, [isAuthenticated, language, updateLanguagePreference, user?.preferredLanguage]);

  const t = useCallback(
    (key: string, values?: TranslateValues) => {
      const currentDict = dictionaries[language] ?? dictionaries.en;
      const fallback = dictionaries.en;
      const raw = currentDict[key] ?? fallback[key];
      if (Array.isArray(raw)) return raw[0] ?? key;
      if (typeof raw === "string") return interpolate(raw, values);
      return key;
    },
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      languageOptions: LANGUAGE_OPTIONS,
      setLanguage,
      t,
    }),
    [language, setLanguage, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export function useLanguageLabel() {
  const { language } = useI18n();
  return getLanguageOption(language);
}
