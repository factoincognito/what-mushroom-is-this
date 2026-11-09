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
  /** The New find screen (docs/SPEC.md 3.1, 3.6). */
  readonly newFind: {
    readonly title: string;
    /** Shown while the app asks for the camera, saying what it is for. */
    readonly asking: string;
    readonly takePhoto: string;
    readonly pickFromGallery: string;
    readonly saving: string;
    readonly saved: string;
    /** The way back to the Log screen once the find is saved. */
    readonly back: string;
    readonly saveFailed: string;
    readonly retrySave: string;
    /** Drops the photo whose save failed, so that a new one can be taken. */
    readonly discardPhoto: string;
    /** The camera or the gallery failed to give a photo. */
    readonly pickFailed: string;
    /** The camera permission was refused; the app may ask again. */
    readonly cameraDenied: string;
    /** The camera permission was refused and the phone lets the app ask no more. */
    readonly cameraBlocked: string;
    readonly openSettings: string;
  };
  /**
   * The analysis queue (docs/SPEC.md 3.3, 3.4): a message for each error class and stop. `{time}`,
   * `{status}` and `{detail}` are filled in by `src/queue/messages.ts`.
   */
  readonly queue: {
    readonly analyseNow: string;
    /** The link to Settings when the queue stopped for a setting. */
    readonly openSettings: string;
    readonly running: string;
    /** A run ended with the finds still waiting. */
    readonly paused: {
      readonly network: string;
      readonly timeOut: string;
      readonly server: string;
    };
    readonly stopped: {
      /** A 429 with `retry-after`: the queue starts again by itself at `{time}`. */
      readonly rateLimitedUntil: string;
      /** A spend limit whose message states when access resumes, `{time}`. */
      readonly spendLimitUntil: string;
      readonly rateLimited: string;
      readonly noKey: string;
      readonly keyRefused: string;
      readonly noCredit: string;
      readonly modelUnknown: string;
      readonly answer: string;
      readonly photoUnreadable: string;
      /** `{status}`: the answer's HTTP status. */
      readonly other: string;
    };
    /** Why a find failed; `{detail}` names the refused marker, the status or the answer's fault. */
    readonly failed: {
      readonly segmentCheck: string;
      readonly request: string;
      readonly answer: string;
    };
    /** A failed new analysis of a find that has an answer. */
    readonly answerKept: string;
  };
};

/**
 * The strings whose Swedish or Italian text no speaker of the language has checked yet, by key
 * path: an entry names one string ("settings.title") or a group of them ("log"). An entry is
 * removed once a speaker has checked it. Every string is listed but the disclaimer, which is the
 * approved text of docs/SPEC.md 3.5, its Italian checked by an Italian speaker. The two lists
 * are kept apart, as each language is checked by its own speaker.
 */
export const NOT_CHECKED_BY_A_SPEAKER: {
  readonly sv: readonly string[];
  readonly it: readonly string[];
} = {
  sv: [
    "languageName",
    "firstStart",
    "log",
    "settings.title",
    "settings.languageHeading",
    "settings.key",
    "settings.model",
    "notFound",
    "newFind",
    "queue",
  ],
  it: [
    "languageName",
    "firstStart",
    "log",
    "settings.title",
    "settings.languageHeading",
    "settings.key",
    "settings.model",
    "notFound",
    "newFind",
    "queue",
  ],
};

export const STRINGS: { readonly [L in Language]: Strings } = {
  // Not checked by a Swedish speaker, but for the disclaimer (NOT_CHECKED_BY_A_SPEAKER).
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
    newFind: {
      title: "Nytt fynd",
      asking: "Appen ber om att få använda kameran, för att ta fotot.",
      takePhoto: "Ta ett foto",
      pickFromGallery: "Välj ett foto i galleriet",
      saving: "Sparar fyndet …",
      saved: "Fyndet är sparat. Det väntar på analys.",
      back: "Tillbaka till Fynd",
      saveFailed: "Fyndet gick inte att spara. Försök igen.",
      retrySave: "Spara igen",
      discardPhoto: "Släng fotot",
      pickFailed: "Fotot gick inte att ta eller välja. Försök igen.",
      cameraDenied:
        "Appen får inte använda kameran, så den kan inte ta något foto. Du kan välja ett foto i galleriet i stället.",
      cameraBlocked:
        "Appen får inte använda kameran. Du kan tillåta det i telefonens inställningar eller välja ett foto i galleriet.",
      openSettings: "Öppna telefonens inställningar",
    },
    queue: {
      analyseNow: "Analysera nu",
      openSettings: "Öppna Inställningar",
      running: "Analyserar fynd …",
      paused: {
        network: "Inget nätverk. Fynden väntar och analyseras när nätverket är tillbaka.",
        timeOut:
          "Claude-API:t svarade inte i tid. Fynden väntar och prövas igen vid nästa körning.",
        server:
          "Claude-API:t hade ett fel hos Anthropic. Fynden väntar och prövas igen vid nästa körning.",
      },
      stopped: {
        rateLimitedUntil:
          "Claude-API:ts hastighetsgräns är nådd. Analysen startar igen av sig själv: {time}.",
        spendLimitUntil:
          "En kostnadsgräns för nyckelns konto är nådd. Enligt API:t går det att fortsätta: {time}. Tryck då på Analysera nu.",
        rateLimited:
          "En hastighets- eller kostnadsgräns för nyckelns konto är nådd. Tryck på Analysera nu för att försöka igen.",
        noKey: "Analysen behöver din Claude-API-nyckel. Lägg till den i Inställningar.",
        keyRefused:
          "Claude-API:t godtog inte nyckeln, eller så saknar den behörighet. Ange en giltig nyckel i Inställningar.",
        noCredit:
          "Nyckelns konto har ingen kredit kvar. Fyll på krediten och tryck sedan på Analysera nu.",
        modelUnknown: "Claude-API:t känner inte till modellen. Välj en annan i Inställningar.",
        answer:
          "Ett svar hade inte den väntade formen, eller kom inte från Claude-API:t (till exempel en inloggningssida för wifi). Det fyndet är markerat som misslyckat. Tryck på Analysera nu för att fortsätta.",
        photoUnreadable:
          "Ett fynds foto gick inte att läsa för analys. Tryck på Analysera nu för att försöka igen.",
        other:
          "Claude-API:t svarade med status {status}. Tryck på Analysera nu för att försöka igen.",
      },
      failed: {
        segmentCheck:
          "Fotot innehåller data som inte skickas ({detail}), så det analyserades inte.",
        request: "Claude-API:t avvisade förfrågan ({detail}).",
        answer: "Svaret hade inte den väntade formen ({detail}).",
      },
      answerKept: "Den nya analysen misslyckades. Det tidigare svaret finns kvar.",
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
    newFind: {
      title: "New find",
      asking: "The app asks to use the camera, to take the photo.",
      takePhoto: "Take a photo",
      pickFromGallery: "Pick a photo from the gallery",
      saving: "Saving the find…",
      saved: "The find is saved. It waits for analysis.",
      back: "Back to Finds",
      saveFailed: "The find could not be saved. Try again.",
      retrySave: "Save again",
      discardPhoto: "Discard the photo",
      pickFailed: "The photo could not be taken or picked. Try again.",
      cameraDenied:
        "The app may not use the camera, so it cannot take a photo. You can pick a photo from the gallery instead.",
      cameraBlocked:
        "The app may not use the camera. You can allow it in the phone's settings, or pick a photo from the gallery.",
      openSettings: "Open the phone's settings",
    },
    queue: {
      analyseNow: "Analyse now",
      openSettings: "Open Settings",
      running: "Analysing finds…",
      paused: {
        network: "No network. The finds wait and are analysed when the network is back.",
        timeOut:
          "The Claude API did not answer in time. The finds wait and are tried again at the next run.",
        server:
          "The Claude API had a fault on Anthropic's side. The finds wait and are tried again at the next run.",
      },
      stopped: {
        rateLimitedUntil:
          "The Claude API's rate limit is reached. Analysis starts again by itself: {time}.",
        spendLimitUntil:
          "A spend limit on the key's account is reached. Access resumes, the API says: {time}. Then tap Analyse now.",
        rateLimited:
          "A rate or spend limit on the key's account is reached. Tap Analyse now to try again.",
        noKey: "Analysis needs your Claude API key. Add it in Settings.",
        keyRefused:
          "The Claude API refused the key, or the key lacks permission. Enter a valid key in Settings.",
        noCredit: "The key's account has no credit left. Add credit, then tap Analyse now.",
        modelUnknown: "The Claude API does not know the model. Choose another in Settings.",
        answer:
          "An answer did not have the expected form, or did not come from the Claude API (for example a Wi-Fi sign-in page). That find is marked failed. Tap Analyse now to go on.",
        photoUnreadable:
          "A find's photo could not be read for analysis. Tap Analyse now to try again.",
        other: "The Claude API answered with status {status}. Tap Analyse now to try again.",
      },
      failed: {
        segmentCheck: "The photo holds data that is not sent ({detail}), so it was not analysed.",
        request: "The Claude API refused the request ({detail}).",
        answer: "The answer did not have the expected form ({detail}).",
      },
      answerKept: "The new analysis failed. The earlier answer is kept.",
    },
  },
  // Not checked by an Italian speaker, but for the disclaimer (NOT_CHECKED_BY_A_SPEAKER).
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
    newFind: {
      title: "Nuovo ritrovamento",
      asking: "L'app chiede di usare la fotocamera, per scattare la foto.",
      takePhoto: "Scatta una foto",
      pickFromGallery: "Scegli una foto dalla galleria",
      saving: "Salvataggio del ritrovamento…",
      saved: "Il ritrovamento è salvato. È in attesa di analisi.",
      back: "Torna a Ritrovamenti",
      saveFailed: "Non è stato possibile salvare il ritrovamento. Riprova.",
      retrySave: "Salva di nuovo",
      discardPhoto: "Scarta la foto",
      pickFailed: "Non è stato possibile scattare o scegliere la foto. Riprova.",
      cameraDenied:
        "L'app non può usare la fotocamera, quindi non può scattare foto. Puoi invece scegliere una foto dalla galleria.",
      cameraBlocked:
        "L'app non può usare la fotocamera. Puoi consentirlo nelle impostazioni del telefono, oppure scegliere una foto dalla galleria.",
      openSettings: "Apri le impostazioni del telefono",
    },
    queue: {
      analyseNow: "Analizza ora",
      openSettings: "Apri Impostazioni",
      running: "Analisi dei ritrovamenti in corso…",
      paused: {
        network:
          "Nessuna rete. I ritrovamenti restano in attesa e vengono analizzati quando la rete torna.",
        timeOut:
          "L'API di Claude non ha risposto in tempo. I ritrovamenti restano in attesa e vengono riprovati alla prossima esecuzione.",
        server:
          "L'API di Claude ha avuto un guasto da parte di Anthropic. I ritrovamenti restano in attesa e vengono riprovati alla prossima esecuzione.",
      },
      stopped: {
        rateLimitedUntil:
          "È stato raggiunto il limite di frequenza dell'API di Claude. L'analisi riparte da sola: {time}.",
        spendLimitUntil:
          "È stato raggiunto un limite di spesa sull'account della chiave. Secondo l'API, l'accesso riprende: {time}. Tocca allora Analizza ora.",
        rateLimited:
          "È stato raggiunto un limite di frequenza o di spesa sull'account della chiave. Tocca Analizza ora per riprovare.",
        noKey: "L'analisi richiede la tua chiave API di Claude. Aggiungila in Impostazioni.",
        keyRefused:
          "L'API di Claude ha rifiutato la chiave, oppure la chiave non ha l'autorizzazione. Inserisci una chiave valida in Impostazioni.",
        noCredit:
          "L'account della chiave non ha più credito. Aggiungi credito, poi tocca Analizza ora.",
        modelUnknown: "L'API di Claude non conosce il modello. Scegline un altro in Impostazioni.",
        answer:
          "Una risposta non aveva la forma prevista, oppure non veniva dall'API di Claude (ad esempio una pagina di accesso al Wi-Fi). Quel ritrovamento è segnato come non riuscito. Tocca Analizza ora per continuare.",
        photoUnreadable:
          "Non è stato possibile leggere la foto di un ritrovamento per l'analisi. Tocca Analizza ora per riprovare.",
        other:
          "L'API di Claude ha risposto con lo stato {status}. Tocca Analizza ora per riprovare.",
      },
      failed: {
        segmentCheck:
          "La foto contiene dati che non vengono inviati ({detail}), quindi non è stata analizzata.",
        request: "L'API di Claude ha rifiutato la richiesta ({detail}).",
        answer: "La risposta non aveva la forma prevista ({detail}).",
      },
      answerKept: "La nuova analisi non è riuscita. La risposta precedente è mantenuta.",
    },
  },
};
