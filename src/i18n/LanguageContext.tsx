import { getLocales } from "expo-localization";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

import { deviceLanguage, resolveLanguage } from "./chooseLanguage";
import { FALLBACK_LANGUAGE, type Language } from "./languages";
import { STRINGS, type Strings } from "./strings";

type LanguageState = {
  /** The language in use. */
  readonly language: Language;
  /** The strings of the language in use. */
  readonly strings: Strings;
  /** Chooses a language, which overrides the phone's. Kept in memory only, for now. */
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

export function LanguageProvider({ children }: { readonly children: ReactNode }) {
  const [device] = useState(readDeviceLanguage);
  const [chosen, setChosen] = useState<Language | null>(null);
  const state = useMemo<LanguageState>(() => {
    const language = resolveLanguage(chosen, device);
    return { language, strings: STRINGS[language], chooseLanguage: setChosen };
  }, [chosen, device]);
  return <LanguageContext.Provider value={state}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageState {
  const state = useContext(LanguageContext);
  if (state === null) {
    throw new Error("useLanguage must be used inside a LanguageProvider");
  }
  return state;
}
