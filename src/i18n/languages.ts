/** The app's languages (docs/SPEC.md 1, 3.1). */
export const LANGUAGES = ["sv", "en", "it"] as const;

export type Language = (typeof LANGUAGES)[number];

/** The language used when the phone's language is not one of the app's. */
export const FALLBACK_LANGUAGE: Language = "en";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}
