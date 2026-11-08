import { FALLBACK_LANGUAGE, isLanguage, type Language } from "./languages";

/**
 * The app's language from the phone's locales, as `expo-localization`'s `getLocales()` gives
 * them, most preferred first: the phone's language when it is one of the app's, otherwise
 * English (docs/SPEC.md 3.1). Only the first locale counts, since that is the phone's
 * language. The input comes from outside the app, so anything malformed gives English.
 */
export function deviceLanguage(locales: unknown): Language {
  if (!Array.isArray(locales)) {
    return FALLBACK_LANGUAGE;
  }
  const first: unknown = locales[0];
  if (typeof first !== "object" || first === null || !("languageCode" in first)) {
    return FALLBACK_LANGUAGE;
  }
  const code: unknown = first.languageCode;
  if (typeof code !== "string") {
    return FALLBACK_LANGUAGE;
  }
  const lower = code.toLowerCase();
  return isLanguage(lower) ? lower : FALLBACK_LANGUAGE;
}

/** The language in use: the one the user chose, if any, over the phone's. */
export function resolveLanguage(chosen: Language | null, device: Language): Language {
  return chosen ?? device;
}
