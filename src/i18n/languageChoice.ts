import type { KeyValueStore } from "../storage/keyValueStore";
import { isLanguage, type Language } from "./languages";

/** The store key under which the user's choice of language is kept across restarts. */
export const LANGUAGE_CHOICE_KEY = "language.chosen";

/**
 * The language the user chose at an earlier start, or null when there is none. A stored value
 * that is not one of the app's languages, and a store that cannot be read, count as no choice.
 */
export async function readLanguageChoice(store: KeyValueStore): Promise<Language | null> {
  try {
    const value: unknown = await store.getItem(LANGUAGE_CHOICE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves the choice. A failed write is reported, not thrown. */
export async function saveLanguageChoice(
  store: KeyValueStore,
  language: Language,
): Promise<{ readonly ok: boolean }> {
  try {
    await store.setItem(LANGUAGE_CHOICE_KEY, language);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
