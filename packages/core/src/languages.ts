/**
 * Reading languages offered for summaries. English is the reference language: every summary
 * exists in English, other languages are generated only for high-importance stories
 * (see TRANSLATE_LANGUAGES in the pipeline) and fall back to English otherwise.
 * Adding a language needs no database change — add it here and to TRANSLATE_LANGUAGES.
 */
export const LANGUAGES = [
  { code: "en", name: "English", native: "English", rtl: false },
  { code: "bn", name: "Bengali", native: "বাংলা", rtl: false },
  { code: "hi", name: "Hindi", native: "हिन्दी", rtl: false },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "es", name: "Spanish", native: "Español", rtl: false },
  { code: "fr", name: "French", native: "Français", rtl: false },
  { code: "pt", name: "Portuguese", native: "Português", rtl: false },
  { code: "de", name: "German", native: "Deutsch", rtl: false },
  { code: "zh", name: "Chinese", native: "中文", rtl: false },
  { code: "ja", name: "Japanese", native: "日本語", rtl: false },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", rtl: false },
  { code: "ur", name: "Urdu", native: "اردو", rtl: true },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const REFERENCE_LANGUAGE: LanguageCode = "en";

export function isLanguageCode(value: string): value is LanguageCode {
  return LANGUAGES.some((l) => l.code === value);
}

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
