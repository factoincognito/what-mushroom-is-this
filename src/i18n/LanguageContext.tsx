import { getLocales } from "expo-localization";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { KeyValueStore } from "../storage/keyValueStore";
import { deviceLanguage, resolveLanguage } from "./chooseLanguage";
import { readLanguageChoice, saveLanguageChoice } from "./languageChoice";
import { FALLBACK_LANGUAGE, type Language } from "./languages";
import { STRINGS, type Strings } from "./strings";

type LanguageState = {
  /** The language in use. */
  readonly language: Language;
  /** The strings of the language in use. */
  readonly strings: Strings;
  /**
   * Chooses a language, which overrides the phone's, and keeps the choice across restarts. If it
   * cannot be stored, the language still changes for this run.
   */
  readonly chooseLanguage: (language: Language) => void;
};

const LanguageContext = createContext<LanguageState | null>(null);

/** The phone's language, or English when the phone's locales cannot be read. */
function readDeviceLanguage(): Language {
  try {
    return deviceLanguage(getLocales());
  } catch {
    return FALLBACK_LANGUAGE;
  }
}

type LanguageProviderProps = {
  /** Where the user's choice of language is kept. */
  readonly store: KeyValueStore;
  readonly children: ReactNode;
};

/**
 * Gives the app its language. Nothing is shown until the choice of an earlier start has been
 * read, so the app never opens in the phone's language and then switches.
 */
export function LanguageProvider({ store, children }: LanguageProviderProps) {
  const [device] = useState(readDeviceLanguage);
  const [chosen, setChosen] = useState<Language | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    readLanguageChoice(store).then((earlier) => {
      if (active) {
        setChosen(earlier);
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [store]);

  const chooseLanguage = useCallback(
    (language: Language) => {
      setChosen(language);
      saveLanguageChoice(store, language);
    },
    [store],
  );

  const state = useMemo<LanguageState>(() => {
    const language = resolveLanguage(chosen, device);
    return { language, strings: STRINGS[language], chooseLanguage };
  }, [chosen, device, chooseLanguage]);

  if (!loaded) {
    return null;
  }
  return <LanguageContext.Provider value={state}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageState {
  const state = useContext(LanguageContext);
  if (state === null) {
    throw new Error("useLanguage must be used inside a LanguageProvider");
  }
  return state;
}
