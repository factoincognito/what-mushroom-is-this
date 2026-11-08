import type { Language } from "./languages";

/** The app's strings in one language. Every language has every key, or the type check fails. */
export type Strings = {
  /** The language's own name for itself, as the language choice shows it. */
  readonly languageName: string;
  /** The disclaimer of docs/SPEC.md 3.5, exactly as written there. */
  readonly disclaimer: string;
  readonly firstStart: {
    readonly title: string;
    readonly accept: string;
  };
  readonly log: {
    readonly title: string;
    readonly empty: string;
    readonly newFind: string;
    readonly settings: string;
  };
  readonly settings: {
    readonly title: string;
    readonly languageHeading: string;
    readonly key: {
      readonly heading: string;
      /** The status line when a key is saved. */
      readonly stored: string;
      /** The status line when no key is saved. */
      readonly none: string;
      readonly unreadable: string;
      /** The label of the field a key is typed or pasted into. */
      readonly input: string;
      readonly save: string;
      readonly remove: string;
      /** The message once a key is saved. */
      readonly saved: string;
      /** The message once the key is removed. */
      readonly removed: string;
      readonly empty: string;
      /** The message for a key the analysis module would refuse to send: not printable ASCII. */
      readonly notSendable: string;
      readonly saveFailed: string;
      readonly removeFailed: string;
    };
    readonly model: {
      readonly heading: string;
      /** The label before the model ID in use. */
      readonly inUse: string;
      /** The mark of the default model in the list. */
      readonly default: string;
      /** The label of the field another model ID is typed into. */
      readonly input: string;
      readonly save: string;
      readonly saved: string;
      readonly empty: string;
      readonly invalid: string;
      readonly saveFailed: string;
    };
  };
  readonly notFound: {
    readonly title: string;
    readonly message: string;
    readonly back: string;
  };
};

/**
 * The groups of strings, by key path, whose Swedish or Italian text no speaker of the language
 * has checked yet. A group is removed from here once a speaker has checked it.
 */
export const NOT_CHECKED_BY_A_SPEAKER: {
  readonly sv: readonly string[];
  readonly it: readonly string[];
} = {
  sv: ["settings.key", "settings.model"],
  it: ["settings.key", "settings.model"],
};

export const STRINGS: { readonly [L in Language]: Strings } = {
  sv: {
    languageName: "Svenska",
    disclaimer:
      "Ätligheten som visas gäller den art som appen har matchat. Det finns ingen garanti för att svampen på ditt foto är den arten.",
    firstStart: {
      title: "Innan du börjar",
      accept: "Godkänn",
    },
    log: {
      title: "Fynd",
      empty: "Inga fynd ännu.",
      newFind: "Nytt fynd",
      settings: "Inställningar",
    },
    settings: {
      title: "Inställningar",
      languageHeading: "Språk",
      // Not checked by a Swedish speaker (NOT_CHECKED_BY_A_SPEAKER).
      key: {
        heading: "API-nyckel",
        stored: "En nyckel är sparad.",
        none: "Ingen nyckel är sparad.",
        unreadable: "Den sparade nyckeln gick inte att läsa.",
        input: "Ny API-nyckel",
        save: "Spara nyckeln",
        remove: "Ta bort nyckeln",
        saved: "Nyckeln är sparad.",
        removed: "Nyckeln är borttagen.",
        empty: "Nyckeln är tom, så inget sparades.",
        notSendable:
          "Nyckeln innehåller ett tecken som en API-nyckel inte kan ha, till exempel ett mellanslag inuti, ett typografiskt citattecken eller en bokstav utanför vanlig ASCII. Den sparades inte.",
        saveFailed: "Nyckeln gick inte att spara. Försök igen.",
        removeFailed: "Nyckeln gick inte att ta bort. Försök igen.",
      },
      // Not checked by a Swedish speaker (NOT_CHECKED_BY_A_SPEAKER).
      model: {
        heading: "Modell",
        inUse: "Modell som används",
        default: "standard",
        input: "Annat modell-ID",
        save: "Spara modellen",
        saved: "Modellen är sparad.",
        empty: "Modell-ID:t är tomt, så inget sparades.",
        invalid:
          "Ett modell-ID har inga mellanslag och bara vanliga ASCII-tecken. Det sparades inte.",
        saveFailed: "Modellen gick inte att spara. Försök igen.",
      },
    },
    notFound: {
      title: "Hittades inte",
      message: "Den här sidan finns inte.",
      back: "Tillbaka till Fynd",
    },
  },
  en: {
    languageName: "English",
    disclaimer:
      "The edibility shown is that of the species the app matched. There is no guarantee that the mushroom in your photo is that species.",
    firstStart: {
      title: "Before you start",
      accept: "Accept",
    },
    log: {
      title: "Finds",
      empty: "No finds yet.",
      newFind: "New find",
      settings: "Settings",
    },
    settings: {
      title: "Settings",
      languageHeading: "Language",
      key: {
        heading: "API key",
        stored: "A key is saved.",
        none: "No key is saved.",
        unreadable: "The saved key could not be read.",
        input: "New API key",
        save: "Save key",
        remove: "Remove key",
        saved: "The key is saved.",
        removed: "The key is removed.",
        empty: "The key is empty, so nothing was saved.",
        notSendable:
          "The key holds a character an API key cannot have, such as a space inside it, a typographic quote or a letter outside plain ASCII. It was not saved.",
        saveFailed: "The key could not be saved. Try again.",
        removeFailed: "The key could not be removed. Try again.",
      },
      model: {
        heading: "Model",
        inUse: "Model in use",
        default: "default",
        input: "Another model ID",
        save: "Save model",
        saved: "The model is saved.",
        empty: "The model ID is empty, so nothing was saved.",
        invalid: "A model ID has no spaces and only plain ASCII characters. It was not saved.",
        saveFailed: "The model could not be saved. Try again.",
      },
    },
    notFound: {
      title: "Not found",
      message: "This page does not exist.",
      back: "Back to Finds",
    },
  },
  it: {
    languageName: "Italiano",
    disclaimer:
      "La commestibilità indicata è quella della specie individuata dall'app. Non c'è alcuna garanzia che il fungo nella tua foto sia di quella specie.",
    firstStart: {
      title: "Prima di iniziare",
      accept: "Accetta",
    },
    log: {
      title: "Ritrovamenti",
      empty: "Ancora nessun ritrovamento.",
      newFind: "Nuovo ritrovamento",
      settings: "Impostazioni",
    },
    settings: {
      title: "Impostazioni",
      languageHeading: "Lingua",
      // Not checked by an Italian speaker (NOT_CHECKED_BY_A_SPEAKER).
      key: {
        heading: "Chiave API",
        stored: "Una chiave è salvata.",
        none: "Nessuna chiave è salvata.",
        unreadable: "Non è stato possibile leggere la chiave salvata.",
        input: "Nuova chiave API",
        save: "Salva la chiave",
        remove: "Rimuovi la chiave",
        saved: "La chiave è salvata.",
        removed: "La chiave è rimossa.",
        empty: "La chiave è vuota, quindi non è stato salvato nulla.",
        notSendable:
          "La chiave contiene un carattere che una chiave API non può avere, ad esempio uno spazio al suo interno, una virgoletta tipografica o una lettera al di fuori dell'ASCII semplice. Non è stata salvata.",
        saveFailed: "Non è stato possibile salvare la chiave. Riprova.",
        removeFailed: "Non è stato possibile rimuovere la chiave. Riprova.",
      },
      // Not checked by an Italian speaker (NOT_CHECKED_BY_A_SPEAKER).
      model: {
        heading: "Modello",
        inUse: "Modello in uso",
        default: "predefinito",
        input: "Altro ID modello",
        save: "Salva il modello",
        saved: "Il modello è salvato.",
        empty: "L'ID del modello è vuoto, quindi non è stato salvato nulla.",
        invalid:
          "Un ID modello non ha spazi e contiene solo caratteri ASCII semplici. Non è stato salvato.",
        saveFailed: "Non è stato possibile salvare il modello. Riprova.",
      },
    },
    notFound: {
      title: "Non trovata",
      message: "Questa pagina non esiste.",
      back: "Torna a Ritrovamenti",
    },
  },
};
