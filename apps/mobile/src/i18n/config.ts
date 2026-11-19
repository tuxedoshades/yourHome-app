export const LANGUAGE_STORE_KEY = "yourhome.i18n.language";

export type AppLanguage = "ar" | "de" | "en" | "es" | "fr" | "ht" | "it" | "nl" | "pt" | "ru";

export type LanguageOption = {
  code: AppLanguage;
  shortLabel: string;
  flag: string;
  name: string;
  nativeName: string;
};

export const LANGUAGE_OPTIONS: LanguageOption[] = (
  [
    { code: "ar", shortLabel: "AR", flag: "🇸🇦", name: "Arabic", nativeName: "العربية" },
    { code: "nl", shortLabel: "NL", flag: "🇳🇱", name: "Dutch", nativeName: "Nederlands" },
    { code: "en", shortLabel: "EN", flag: "🇺🇸", name: "English", nativeName: "English" },
    { code: "fr", shortLabel: "FR", flag: "🇫🇷", name: "French", nativeName: "Français" },
    { code: "de", shortLabel: "DE", flag: "🇩🇪", name: "German", nativeName: "Deutsch" },
    { code: "ht", shortLabel: "HT", flag: "🇭🇹", name: "Haitian Creole", nativeName: "Kreyòl Ayisyen" },
    { code: "it", shortLabel: "IT", flag: "🇮🇹", name: "Italian", nativeName: "Italiano" },
    { code: "pt", shortLabel: "PT", flag: "🇧🇷", name: "Portuguese", nativeName: "Português" },
    { code: "ru", shortLabel: "RU", flag: "🇷🇺", name: "Russian", nativeName: "Русский" },
    { code: "es", shortLabel: "ES", flag: "🇪🇸", name: "Spanish", nativeName: "Español" },
  ] as LanguageOption[]
).sort((a, b) => a.name.localeCompare(b.name, "en"));

export const DEFAULT_LANGUAGE: AppLanguage = "en";

export const SUPPORTED_LANGUAGES = LANGUAGE_OPTIONS.map((option) => option.code);

export function isSupportedLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && SUPPORTED_LANGUAGES.includes(value as AppLanguage);
}

export function getLanguageOption(code: AppLanguage) {
  return LANGUAGE_OPTIONS.find((option) => option.code === code) ?? LANGUAGE_OPTIONS[0];
}
