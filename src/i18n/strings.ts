import type { Language } from "./languages";

/** The app's strings in one language. Every language has every key, or the type check fails. */
export type Strings = {
  /** The language's own name for itself, as the language choice shows it. */
  readonly languageName: string;
  /** The disclaimer of docs/SPEC.md 3.5, exactly as written there. */
  readonly disclaimer: string;
  /**
   * The disclaimer for a lookup without photos (docs/SPEC.md 3.9, Answers): the first sentence of
   * `disclaimer`, and in place of its second, the one about a description.
   */
  readonly disclaimerDescribed: string;
  readonly firstStart: {
    readonly title: string;
    readonly accept: string;
  };
  readonly log: {
    readonly title: string;
    readonly empty: string;
    readonly newFind: string;
    /** The link to the text lookup (docs/SPEC.md 3.9). */
    readonly textLookup: string;
    readonly settings: string;
    /** A find in the list that waits for analysis. */
    readonly waiting: string;
    /** A find in the list whose analysis failed; its screen names the cause. */
    readonly failed: string;
    /** The list could not be read; the error itself is not shown. */
    readonly unreadable: string;
    readonly retry: string;
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
    /** The starting values of the lookups' "Save" switch (docs/SPEC.md 3.9). */
    readonly lookups: {
      readonly heading: string;
      /** The label of the text lookup's switch. */
      readonly textSave: string;
      /** The label of the photo lookup's switch (PBI-2.13). */
      readonly photoSave: string;
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
    /** Shown while the app asks for the camera and the location, saying what each is for. */
    readonly asking: string;
    readonly takePhoto: string;
    readonly pickFromGallery: string;
    readonly saving: string;
    /** A photo of the batch is saved to the find (docs/SPEC.md 3.9, Batches). */
    readonly saved: string;
    /** The title when photos are added to a find from its screen. */
    readonly addTitle: string;
    /** The photos the find holds against the most it may; `{count}` and `{max}` are filled in. */
    readonly photoCount: string;
    /** The find holds the most photos it may, so no more are offered. */
    readonly maxReached: string;
    /** Completes the batch, which the queue then analyses. */
    readonly analyse: string;
    /** The batch could not be completed; the error is not shown. */
    readonly analyseFailed: string;
    /** The find to add photos to does not exist or cannot be read; the error is not shown. */
    readonly findUnavailable: string;
    readonly saveFailed: string;
    readonly retrySave: string;
    /** Drops the photo whose save failed, so that a new one can be taken; asks first. */
    readonly discardPhoto: string;
    /** The question "Discard the photo" asks first (PBI-1.20), and its two answers. */
    readonly discardConfirm: string;
    readonly discardYes: string;
    readonly discardCancel: string;
    /** The question asked when the screen is left while a photo is kept, and its two answers. */
    readonly leaveConfirm: string;
    readonly leaveYes: string;
    readonly leaveCancel: string;
    /** The camera or the gallery failed to give a photo. */
    readonly pickFailed: string;
    /** The camera permission was refused; the app may ask again. */
    readonly cameraDenied: string;
    /** The camera permission was refused and the phone lets the app ask no more. */
    readonly cameraBlocked: string;
    /** The location permission is not given: photos from the camera get no position. */
    readonly locationDenied: string;
    readonly openSettings: string;
    /** The label of a new photo lookup's "Save" switch (docs/SPEC.md 3.9; PBI-2.13). */
    readonly save: string;
    /** What the switch does, on and off. */
    readonly saveHint: string;
    /** The photos an unsaved lookup holds against the most; `{count}` and `{max}` are filled in. */
    readonly heldCount: string;
    /** The unsaved lookup holds the most photos a find may, so no more are offered. */
    readonly heldMaxReached: string;
    /** An unsaved lookup is being analysed on the screen. */
    readonly analysing: string;
    /** The analysis could not run for an error in the app; the error itself is not shown. */
    readonly analysisError: string;
    /** The offer after a pause or without a key, so the lookup waits in the queue. */
    readonly turnSaveOn: string;
    /** The question asked when the screen is left with an unsaved lookup. */
    readonly leaveLookupConfirm: string;
    /**
     * When several photos are kept after a failed save (turning Save on with several held): the
     * message, the button, the question and its keep answer, and the leave question.
     */
    readonly savePhotosFailed: string;
    readonly discardPhotos: string;
    readonly discardPhotosConfirm: string;
    readonly discardPhotosCancel: string;
    readonly leavePhotosConfirm: string;
  };
  /** The text lookup screen (docs/SPEC.md 3.9, Lookups). `{count}` and `{max}` are filled in. */
  readonly lookup: {
    readonly title: string;
    /** Shown while the app asks for the location, saying what it is for. */
    readonly asking: string;
    /** The label of the field the description is written in. */
    readonly input: string;
    /** The characters written against the limit. */
    readonly count: string;
    /** The label of the "Save" switch. */
    readonly save: string;
    /** What the switch does. */
    readonly saveHint: string;
    readonly analyse: string;
    readonly analysing: string;
    readonly saving: string;
    /** Nothing is written, so there is nothing to analyse or save. */
    readonly empty: string;
    readonly saveFailed: string;
    /** The offer after a pause or without a key, so the lookup waits in the queue. */
    readonly turnSaveOn: string;
    /** The analysis could not run for an error in the app; the error itself is not shown. */
    readonly analysisError: string;
    /** The question asked when the screen is left with an unsaved lookup, and its answers. */
    readonly leaveConfirm: string;
    readonly leaveYes: string;
    readonly leaveCancel: string;
    /** The location permission is not given: a saved lookup gets no position. */
    readonly locationDenied: string;
    readonly openSettings: string;
  };
  /**
   * The analysis queue (docs/SPEC.md 3.3, 3.4): a message for each error class and stop. `{time}`,
   * `{status}` and `{number}` are filled in by `src/queue/messages.ts`.
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
      /** The key belongs to no workspace; the user must replace it with one that does. */
      readonly keyNotScoped: string;
      readonly noCredit: string;
      readonly modelUnknown: string;
      readonly answer: string;
      /** A run failed inside the app; the error itself is not shown. */
      readonly internalError: string;
      /** `{status}`: the answer's HTTP status. */
      readonly other: string;
    };
    /**
     * Why a find failed, in plain words: one sentence for each form of the stored detail, and a
     * general one for a form the app does not know (`src/queue/messages.ts`). No stored code,
     * marker number, status or file path is shown.
     */
    readonly failed: {
      /** The segment check refused the photo prepared for analysis. */
      readonly segmentCheck: {
        /** APP0 that is not plain JFIF, such as a JFIF extension. */
        readonly app0: string;
        /** APP1: EXIF or XMP. */
        readonly app1: string;
        /** APP2 that is not an ICC colour profile, such as a Multi-Picture index. */
        readonly app2: string;
        /** APP13: IPTC. */
        readonly app13: string;
        /** Another application segment; `{number}` is its number, 3 to 15. */
        readonly otherApp: string;
        /** COM. */
        readonly comment: string;
        /** Any other marker off the allowlist. */
        readonly otherMarker: string;
        /** Bytes after the end of the image. */
        readonly trailingData: string;
        readonly truncated: string;
        readonly malformed: string;
        readonly notJpeg: string;
        /** The encoder gave no bytes to check. */
        readonly invalidInput: string;
        readonly unknown: string;
      };
      /** The photo itself could not be loaded, decoded or sized. */
      readonly photo: {
        readonly loadFailed: string;
        readonly invalidSize: string;
        readonly unknown: string;
      };
      /** The API refused the request (400, 413). */
      readonly request: {
        readonly wrong: string;
        readonly tooLarge: string;
        readonly unknown: string;
      };
      /** The answer was not from the API, was cut off, or did not fit the shape. */
      readonly answer: {
        readonly notApi: string;
        readonly cutOff: string;
        /** Off the shape, and any other answer detail. */
        readonly shape: string;
      };
      /** Claude declined to analyse the photo (`stop_reason` `refusal`). */
      readonly refused: string;
      /** Claude declined to analyse a description, for a lookup without photos. */
      readonly refusedDescribed: string;
      /**
       * A failure of one of a find's several photos (docs/SPEC.md 3.9, Batches): `{number}` is the
       * photo's number, `{reason}` the sentence of its failure.
       */
      readonly numbered: string;
    };
    /** A failed new analysis of a find that has an answer. */
    readonly answerKept: string;
  };
  /**
   * The Find screen (docs/SPEC.md 3.1, 3.5), and what the Log shows of a find. `{edibility}`,
   * `{confidence}`, `{time}`, `{coordinates}` and `{metres}` are filled in by the screens.
   */
  readonly find: {
    readonly title: string;
    /** No find has the address's ID, or the address names no ID. */
    readonly notFound: string;
    /** The store cannot read the find; the error itself is not shown. */
    readonly unreadable: string;
    readonly back: string;
    /** The photo's accessibility label. */
    readonly photo: string;
    /** A photo's label on a find with several (docs/SPEC.md 3.9); `{number}` of `{count}`. */
    readonly photoNumbered: string;
    /** Opens New find to add a batch of photos to the find. */
    readonly addPhotos: string;
    /** The find holds the most photos it may; `{max}` is filled in. */
    readonly maxPhotos: string;
    /** Removes a photo of the find, `{number}`, after a question; and the question's parts. */
    readonly removePhoto: string;
    readonly removePhotoConfirm: string;
    readonly removePhotoYes: string;
    readonly removePhotoCancel: string;
    readonly removePhotoFailed: string;
    /** The photos added since the find's answer, while they are not covered by one. */
    readonly addedPhotos: {
      readonly waiting: string;
      readonly notAnalysed: string;
    };
    /** The label of the Latin name. */
    readonly latin: string;
    /** The edibility, labelled as that of the matched species (SPEC 3.5). */
    readonly edibility: string;
    /** A look-alike's edibility, labelled as that of its own species. */
    readonly lookAlikeEdibility: string;
    readonly edibilities: {
      readonly edible: string;
      readonly edibleAfterPreparation: string;
      readonly notEdible: string;
      readonly poisonous: string;
      readonly deadlyPoisonous: string;
      readonly unknown: string;
    };
    readonly confidence: string;
    /** A confidence from 1 to 100 (SPEC 3.9), put in `confidence`; `{score}` is the number. */
    readonly confidenceScore: string;
    /** A Phase 1 find's level, put in `confidence`. */
    readonly confidences: {
      readonly low: string;
      readonly medium: string;
      readonly high: string;
    };
    /** The confidence is Claude's own statement, not a measured probability (SPEC 3.1). */
    readonly confidenceNote: string;
    /** The heading of the general information. */
    readonly generalInformation: string;
    /** The heading of the poisonous look-alikes. */
    readonly lookAlikes: string;
    readonly noLookAlikes: string;
    readonly noMushroom: string;
    readonly cannotTell: string;
    /** "No mushroom" and "cannot tell" for a lookup without photos (docs/SPEC.md 3.9, Answers). */
    readonly noMushroomDescribed: string;
    readonly cannotTellDescribed: string;
    /** The heading of a text find's description. */
    readonly description: string;
    /**
     * Why the edibility of an answer from the text alone is shown as unknown, for each state of its
     * self-check but "agreed" (docs/SPEC.md 3.9). `{matched}` and `{named}` are the two species.
     */
    readonly selfCheck: {
      readonly waiting: string;
      readonly disagreed: string;
      readonly noSpecies: string;
      readonly failed: string;
      readonly noPicture: string;
    };
    readonly waiting: string;
    /** A failed find; the cause follows in the queue's words. */
    readonly failed: string;
    readonly time: string;
    readonly timeSources: {
      readonly saved: string;
      readonly photo: string;
      readonly photoPhoneOffset: string;
    };
    readonly position: string;
    readonly accuracy: string;
    readonly positionSources: {
      readonly fix: string;
      readonly lastKnown: string;
      readonly photo: string;
    };
    readonly noPosition: string;
    /** The link that opens the phone's own map app. */
    readonly openMap: string;
    readonly mapFailed: string;
    /** Analyses a waiting find at once. */
    readonly analyse: string;
    /** Analyses an analysed or failed find again. */
    readonly analyseAgain: string;
    readonly analysing: string;
    /** The analysis could not run for an error in the app; the error itself is not shown. */
    readonly analysisError: string;
    readonly delete: string;
    readonly deleteConfirm: string;
    /** The delete question for a find without photos. */
    readonly deleteConfirmDescribed: string;
    readonly deleteYes: string;
    readonly deleteCancel: string;
    readonly deleteFailed: string;
  };
  /** The About view (docs/SPEC.md 3.1): the licences and the disclaimer. */
  readonly about: {
    /** The view's title, which is also the text of its link in Settings. */
    readonly title: string;
    readonly appHeading: string;
    readonly librariesHeading: string;
    readonly librariesIntro: string;
    /** In place of the version of a library whose version the build chooses. */
    readonly versionNotPinned: string;
    readonly showText: string;
    readonly hideText: string;
    /** For a library whose licence text is not in the app yet. */
    readonly textMissing: string;
    readonly disclaimerHeading: string;
  };
};

/**
 * The strings whose Swedish or Italian text no speaker of the language has checked yet, by key
 * path: an entry names one string ("settings.title") or a group of them ("log"). An entry is
 * removed once a speaker has checked it. Every string is listed but the disclaimer, which is the
 * approved text of docs/SPEC.md 3.5, its Italian checked by an Italian speaker. The two lists
 * are kept apart, as each language is checked by its own speaker.
 *
 * No speaker has checked the iOS permission texts in `locales/sv.json` and `locales/it.json`
 * either (`ios.NSCameraUsageDescription` and `ios.NSPhotoLibraryUsageDescription`, PBI-1.20, and
 * `ios.NSLocationWhenInUseUsageDescription`, PBI-1.19; six texts in all). They are not in this
 * file, so the lists cannot name them; they are recorded here so that a speaker's check finds
 * them too.
 */
export const NOT_CHECKED_BY_A_SPEAKER: {
  readonly sv: readonly string[];
  readonly it: readonly string[];
} = {
  sv: [
    "languageName",
    "disclaimerDescribed",
    "firstStart",
    "log",
    "settings.title",
    "settings.languageHeading",
    "settings.key",
    "settings.model",
    "settings.lookups",
    "notFound",
    "newFind",
    "lookup",
    "queue",
    "find",
    "about",
  ],
  // The disclaimer for a lookup without photos is to be checked by the Italian speaker who
  // checked the disclaimer of SPEC 3.5 (docs/SPEC.md 3.9, Answers; docs/BACKLOG.md PBI-2.4).
  it: [
    "languageName",
    "disclaimerDescribed",
    "firstStart",
    "log",
    "settings.title",
    "settings.languageHeading",
    "settings.key",
    "settings.model",
    "settings.lookups",
    "notFound",
    "newFind",
    "lookup",
    "queue",
    "find",
    "about",
  ],
};

export const STRINGS: { readonly [L in Language]: Strings } = {
  // Not checked by a Swedish speaker, but for the disclaimer (NOT_CHECKED_BY_A_SPEAKER).
  sv: {
    languageName: "Svenska",
    disclaimer:
      "Ätligheten som visas gäller den art som appen har matchat. Det finns ingen garanti för att svampen på ditt foto är den arten.",
    disclaimerDescribed:
      "Ätligheten som visas gäller den art som appen har matchat. Det finns ingen garanti för att svampen du har beskrivit är den arten.",
    firstStart: {
      title: "Innan du börjar",
      accept: "Godkänn",
    },
    log: {
      title: "Fynd",
      empty: "Inga fynd ännu.",
      newFind: "Nytt fynd",
      textLookup: "Beskriv en svamp",
      settings: "Inställningar",
      waiting: "Väntar på analys",
      failed: "Analysen misslyckades",
      unreadable: "Fyndloggen gick inte att läsa.",
      retry: "Försök igen",
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
      lookups: {
        heading: "Sökningar",
        textSave: "Spara är på när en textsökning börjar",
        photoSave: "Spara är på när en fotosökning börjar",
        saveFailed: "Inställningen gick inte att spara. Försök igen.",
      },
    },
    notFound: {
      title: "Hittades inte",
      message: "Den här sidan finns inte.",
      back: "Tillbaka till Fynd",
    },
    newFind: {
      title: "Nytt fynd",
      asking:
        "Appen ber om att få använda kameran, för att ta fotot, och telefonens plats, för att notera var fyndet gjordes.",
      takePhoto: "Ta ett foto",
      pickFromGallery: "Välj ett foto i galleriet",
      saving: "Sparar fotot …",
      saved: "Fotot är sparat i fyndet.",
      addTitle: "Lägg till foton",
      photoCount: "Fyndet har {count} av högst {max} foton.",
      maxReached: "Fyndet har så många foton som det kan ha.",
      analyse: "Analysera",
      analyseFailed: "Fotona gick inte att skicka vidare för analys. Försök igen.",
      findUnavailable: "Fyndet gick inte att öppna, så inget foto kan läggas till i det.",
      saveFailed: "Fotot gick inte att spara. Försök igen.",
      retrySave: "Spara igen",
      discardPhoto: "Släng fotot",
      discardConfirm: "Slänga fotot? Det är inte sparat och går inte att få tillbaka.",
      discardYes: "Släng",
      discardCancel: "Behåll fotot",
      leaveConfirm:
        "Lämna sidan och slänga fotot? Det är inte sparat och går inte att få tillbaka.",
      leaveYes: "Släng och lämna",
      leaveCancel: "Stanna kvar",
      pickFailed: "Fotot gick inte att ta eller välja. Försök igen.",
      cameraDenied:
        "Appen får inte använda kameran, så den kan inte ta något foto. Du kan välja ett foto i galleriet i stället.",
      cameraBlocked:
        "Appen får inte använda kameran. Du kan tillåta det i telefonens inställningar eller välja ett foto i galleriet.",
      locationDenied:
        "Appen får inte använda telefonens plats, så ett foto från kameran sparas utan position. Du kan tillåta det i telefonens inställningar.",
      openSettings: "Öppna telefonens inställningar",
      save: "Spara",
      saveHint:
        "När Spara är på blir sökningen ett fynd i loggen, och varje foto sparas när det tas eller väljs. När Spara är av finns fotona bara på den här sidan, analyseras här och tas bort när du lämnar den.",
      heldCount: "Sökningen har {count} av högst {max} foton, bara på den här sidan.",
      heldMaxReached: "Sökningen har så många foton som ett fynd kan ha.",
      analysing: "Analyserar …",
      analysisError: "Analysen kunde inte köras på grund av ett fel i appen.",
      turnSaveOn: "Slå på Spara, så att sökningen väntar i kön",
      leaveLookupConfirm:
        "Lämna sidan och slänga sökningen? Den är inte sparad och går inte att få tillbaka.",
      savePhotosFailed: "Fotona gick inte att spara. Försök igen.",
      discardPhotos: "Släng fotona",
      discardPhotosConfirm: "Slänga fotona? De är inte sparade och går inte att få tillbaka.",
      discardPhotosCancel: "Behåll fotona",
      leavePhotosConfirm:
        "Lämna sidan och slänga fotona? De är inte sparade och går inte att få tillbaka.",
    },
    lookup: {
      title: "Beskriv en svamp",
      asking:
        "Appen ber om att få använda telefonens plats, för att notera var en sparad sökning gjordes.",
      input: "Din beskrivning av svampen",
      count: "{count} av {max} tecken",
      save: "Spara",
      saveHint: "När Spara är på blir sökningen ett fynd i loggen och väntar där på analys.",
      analyse: "Analysera",
      analysing: "Analyserar …",
      saving: "Sparar fyndet …",
      empty: "Skriv en beskrivning först.",
      saveFailed: "Fyndet gick inte att spara. Försök igen.",
      turnSaveOn: "Slå på Spara, så att sökningen väntar i kön",
      analysisError: "Analysen kunde inte köras på grund av ett fel i appen.",
      leaveConfirm:
        "Lämna sidan och slänga sökningen? Den är inte sparad och går inte att få tillbaka.",
      leaveYes: "Släng och lämna",
      leaveCancel: "Stanna kvar",
      locationDenied:
        "Appen får inte använda telefonens plats, så en sparad sökning får ingen position. Du kan tillåta det i telefonens inställningar.",
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
        keyNotScoped:
          "Nyckeln hör inte till någon arbetsyta, och appen kan inte ange en arbetsyta. Ersätt den i Inställningar med en nyckel som hör till en arbetsyta.",
        noCredit:
          "Nyckelns konto har ingen kredit kvar. Fyll på krediten och tryck sedan på Analysera nu.",
        modelUnknown: "Claude-API:t känner inte till modellen. Välj en annan i Inställningar.",
        answer:
          "Ett svar hade inte den väntade formen, eller kom inte från Claude-API:t (till exempel en inloggningssida för wifi). Det fyndet är markerat som misslyckat. Tryck på Analysera nu för att fortsätta.",
        internalError:
          "Något gick fel i appen under analysen. Fynden finns kvar. Tryck på Analysera nu för att försöka igen.",
        other:
          "Claude-API:t svarade med status {status}. Tryck på Analysera nu för att försöka igen.",
      },
      failed: {
        segmentCheck: {
          app0: "Fotot innehåller ett APP0-segment som inte är ren JFIF, till exempel ett JFIF-tillägg som kan bära en liten kopia av bilden med egna data. Det skickas inte, så fotot analyserades inte.",
          app1: "Fotot innehåller kameradata eller andra metadata (EXIF eller XMP, APP1-segmentet) som inte skickas, så det analyserades inte.",
          app2: "Fotot har annat än en färgprofil i sitt APP2-segment, till exempel ett register över fler bilder, som inte skickas, så det analyserades inte.",
          app13:
            "Fotot innehåller IPTC-data (APP13-segmentet), till exempel en bildtext eller en plats, som inte skickas, så det analyserades inte.",
          otherApp:
            "Fotot innehåller programdata (APP{number}-segmentet) som inte skickas, så det analyserades inte.",
          comment:
            "Fotot innehåller en kommentar (COM-segmentet) som inte skickas, så det analyserades inte.",
          otherMarker: "Fotot innehåller en del som appen inte skickar, så det analyserades inte.",
          trailingData:
            "Fotot har mer data efter bildens slut, till exempel en bild till, som inte skickas, så det analyserades inte.",
          truncated: "Fotot som förbereddes för analys är avkortat, så det analyserades inte.",
          malformed:
            "Fotot som förbereddes för analys är inte en korrekt uppbyggd JPEG, så det analyserades inte.",
          notJpeg: "Fotot som förbereddes för analys är ingen JPEG, så det analyserades inte.",
          invalidInput:
            "Fotot som förbereddes för analys gick inte att kontrollera, så det analyserades inte.",
          unknown: "Fotot innehåller data som inte skickas, så det analyserades inte.",
        },
        photo: {
          loadFailed:
            "Fotot gick inte att läsa in för analys. Filen kan saknas eller vara skadad, eller så kan telefonen ha ont om minne.",
          invalidSize:
            "Fotots storlek gick inte att läsa, så det kunde inte förberedas för analys.",
          unknown: "Fotot gick inte att läsa för analys.",
        },
        request: {
          wrong: "Claude-API:t avvisade förfrågan som ogiltig.",
          tooLarge: "Claude-API:t avvisade förfrågan som för stor.",
          unknown: "Claude-API:t avvisade förfrågan.",
        },
        answer: {
          notApi: "Svaret kom inte från Claude-API:t, till exempel en inloggningssida för wifi.",
          cutOff: "Claudes svar bröts av innan det var klart.",
          shape: "Claudes svar hade inte den form som appen väntar sig.",
        },
        refused: "Claude avböjde att analysera det här fotot.",
        refusedDescribed: "Claude avböjde att analysera den här beskrivningen.",
        numbered: "Foto {number}: {reason} Du kan ta bort det fotot och analysera fyndet igen.",
      },
      answerKept: "Den nya analysen misslyckades. Det tidigare svaret finns kvar.",
    },
    find: {
      title: "Fynd",
      notFound: "Fyndet finns inte. Det kan ha tagits bort.",
      unreadable: "Fyndet gick inte att läsa.",
      back: "Tillbaka till Fynd",
      photo: "Fotot av fyndet",
      photoNumbered: "Foto {number} av {count} av fyndet",
      addPhotos: "Lägg till foton",
      maxPhotos: "Fyndet har {max} foton, så många som det kan ha.",
      removePhoto: "Ta bort foto {number}",
      removePhotoConfirm:
        "Ta bort foto {number} ur fyndet? Bara appens kopia tas bort; ett foto i telefonens galleri eller filer finns kvar där.",
      removePhotoYes: "Ta bort",
      removePhotoCancel: "Behåll fotot",
      removePhotoFailed: "Fotot gick inte att ta bort. Försök igen.",
      addedPhotos: {
        waiting:
          "Fotona som lagts till sedan det här svaret väntar på analys. Svaret finns kvar tills ett nytt ersätter det.",
        notAnalysed:
          "Fotona som lagts till sedan det här svaret gick inte att analysera. Analysera igen för att analysera fyndet med alla dess foton.",
      },
      latin: "Latin",
      edibility: "Ätlighet för den matchade arten: {edibility}",
      lookAlikeEdibility: "Ätlighet för den här arten: {edibility}",
      edibilities: {
        edible: "Ätlig",
        edibleAfterPreparation: "Ätlig först efter tillagning",
        notEdible: "Inte ätlig",
        poisonous: "Giftig",
        deadlyPoisonous: "Dödligt giftig",
        unknown: "Okänd",
      },
      confidence: "Claudes säkerhet om matchningen: {confidence}",
      confidenceScore: "{score} av 100",
      confidences: {
        low: "låg",
        medium: "medel",
        high: "hög",
      },
      confidenceNote: "Det här är Claudes egen uppgift, inte en uppmätt sannolikhet.",
      generalInformation: "Om arten",
      lookAlikes: "Giftiga förväxlingsarter",
      noLookAlikes: "Claude angav inga giftiga förväxlingsarter.",
      noMushroom: "Claude ser ingen svamp på fotot.",
      cannotTell: "Claude ser en svamp men kan inte avgöra vilken art det är.",
      noMushroomDescribed: "Beskrivningen gäller ingen svamp.",
      cannotTellDescribed:
        "Beskrivningen säger inte tillräckligt för att avgöra vilken art det är.",
      description: "Din beskrivning",
      selfCheck: {
        waiting:
          "Ätligheten visas som okänd tills en kontroll mot en bild av arten bekräftar matchningen. Kontrollen har inte gjorts ännu.",
        disagreed:
          "Ätligheten visas som okänd: en kontroll mot en bild av {matched} angav en annan art, {named}.",
        noSpecies:
          "Ätligheten visas som okänd: en kontroll mot en bild av arten kunde inte ange någon art.",
        failed: "Ätligheten visas som okänd: kontrollen mot en bild av arten misslyckades.",
        noPicture: "Ätligheten visas som okänd: ingen bild av arten hittades för kontrollen.",
      },
      waiting: "Fyndet väntar på analys.",
      failed: "Analysen misslyckades.",
      time: "Taget: {time}",
      timeSources: {
        saved: "Tiden är när fyndet sparades.",
        photo: "Tiden kommer från fotots metadata.",
        photoPhoneOffset:
          "Tiden kommer från fotots metadata, som saknar UTC-förskjutning. Den är läst med telefonens förskjutning det datumet.",
      },
      position: "Position: {coordinates}",
      accuracy: "Noggrannhet cirka {metres} m",
      positionSources: {
        fix: "Positionen är en mätning från telefonen.",
        lastKnown: "Positionen är telefonens senast kända position.",
        photo: "Positionen kommer från fotots metadata.",
      },
      noPosition: "Fyndet har ingen position.",
      openMap: "Öppna i kartappen",
      mapFailed: "Ingen kartapp kunde öppna positionen.",
      analyse: "Analysera fyndet nu",
      analyseAgain: "Analysera igen",
      analysing: "Analyserar …",
      analysisError:
        "Analysen kunde inte köras på grund av ett fel i appen. Fyndet är som det var.",
      delete: "Ta bort fyndet",
      deleteConfirm: "Ta bort fyndet och dess foto? Det går inte att ångra.",
      deleteConfirmDescribed: "Ta bort fyndet? Det går inte att ångra.",
      deleteYes: "Ta bort",
      deleteCancel: "Avbryt",
      deleteFailed: "Fyndet gick inte att ta bort. Försök igen.",
    },
    about: {
      title: "Om appen",
      appHeading: "Appens licens",
      librariesHeading: "Bibliotek",
      librariesIntro: "Appen innehåller dessa bibliotek, under deras egna licenser.",
      versionNotPinned: "väljs när appen byggs",
      showText: "Visa licenstexten",
      hideText: "Dölj licenstexten",
      textMissing: "Licenstexten finns inte i appen ännu.",
      disclaimerHeading: "Ätlighet",
    },
  },
  en: {
    languageName: "English",
    disclaimer:
      "The edibility shown is that of the species the app matched. There is no guarantee that the mushroom in your photo is that species.",
    disclaimerDescribed:
      "The edibility shown is that of the species the app matched. There is no guarantee that the mushroom you described is that species.",
    firstStart: {
      title: "Before you start",
      accept: "Accept",
    },
    log: {
      title: "Finds",
      empty: "No finds yet.",
      newFind: "New find",
      textLookup: "Describe a mushroom",
      settings: "Settings",
      waiting: "Waiting for analysis",
      failed: "The analysis failed",
      unreadable: "The find log could not be read.",
      retry: "Try again",
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
      lookups: {
        heading: "Lookups",
        textSave: "Save is on when a text lookup starts",
        photoSave: "Save is on when a photo lookup starts",
        saveFailed: "The setting could not be saved. Try again.",
      },
    },
    notFound: {
      title: "Not found",
      message: "This page does not exist.",
      back: "Back to Finds",
    },
    newFind: {
      title: "New find",
      asking:
        "The app asks to use the camera, to take the photo, and the phone's location, to note where the find was made.",
      takePhoto: "Take a photo",
      pickFromGallery: "Pick a photo from the gallery",
      saving: "Saving the photo…",
      saved: "The photo is saved to the find.",
      addTitle: "Add photos",
      photoCount: "The find holds {count} of at most {max} photos.",
      maxReached: "The find holds as many photos as it can.",
      analyse: "Analyse",
      analyseFailed: "The photos could not be sent on for analysis. Try again.",
      findUnavailable: "The find could not be opened, so no photo can be added to it.",
      saveFailed: "The photo could not be saved. Try again.",
      retrySave: "Save again",
      discardPhoto: "Discard the photo",
      discardConfirm: "Discard the photo? It is not saved, and it cannot be got back.",
      discardYes: "Discard",
      discardCancel: "Keep the photo",
      leaveConfirm: "Leave and discard the photo? It is not saved, and it cannot be got back.",
      leaveYes: "Discard and leave",
      leaveCancel: "Stay",
      pickFailed: "The photo could not be taken or picked. Try again.",
      cameraDenied:
        "The app may not use the camera, so it cannot take a photo. You can pick a photo from the gallery instead.",
      cameraBlocked:
        "The app may not use the camera. You can allow it in the phone's settings, or pick a photo from the gallery.",
      locationDenied:
        "The app may not use the phone's location, so a photo from the camera is saved without a position. You can allow it in the phone's settings.",
      openSettings: "Open the phone's settings",
      save: "Save",
      saveHint:
        "With Save on, the lookup becomes a find in the log, and each photo is saved as it is taken or picked. With Save off, the photos are held on this screen only, analysed here, and removed when you leave it.",
      heldCount: "The lookup holds {count} of at most {max} photos, on this screen only.",
      heldMaxReached: "The lookup holds as many photos as a find can.",
      analysing: "Analysing…",
      analysisError: "The analysis could not run because of an error in the app.",
      turnSaveOn: "Turn Save on, so the lookup waits in the queue",
      leaveLookupConfirm:
        "Leave and discard the lookup? It is not saved, and it cannot be got back.",
      savePhotosFailed: "The photos could not be saved. Try again.",
      discardPhotos: "Discard the photos",
      discardPhotosConfirm: "Discard the photos? They are not saved, and they cannot be got back.",
      discardPhotosCancel: "Keep the photos",
      leavePhotosConfirm:
        "Leave and discard the photos? They are not saved, and they cannot be got back.",
    },
    lookup: {
      title: "Describe a mushroom",
      asking: "The app asks to use the phone's location, to note where a saved lookup was made.",
      input: "Your description of the mushroom",
      count: "{count} of {max} characters",
      save: "Save",
      saveHint: "With Save on, the lookup becomes a find in the log and waits there for analysis.",
      analyse: "Analyse",
      analysing: "Analysing…",
      saving: "Saving the find…",
      empty: "Write a description first.",
      saveFailed: "The find could not be saved. Try again.",
      turnSaveOn: "Turn Save on, so the lookup waits in the queue",
      analysisError: "The analysis could not run because of an error in the app.",
      leaveConfirm: "Leave and discard the lookup? It is not saved, and it cannot be got back.",
      leaveYes: "Discard and leave",
      leaveCancel: "Stay",
      locationDenied:
        "The app may not use the phone's location, so a saved lookup gets no position. You can allow it in the phone's settings.",
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
        keyNotScoped:
          "The key belongs to no workspace, and the app cannot name one. Replace it in Settings with a key that belongs to a workspace.",
        noCredit: "The key's account has no credit left. Add credit, then tap Analyse now.",
        modelUnknown: "The Claude API does not know the model. Choose another in Settings.",
        answer:
          "An answer did not have the expected form, or did not come from the Claude API (for example a Wi-Fi sign-in page). That find is marked failed. Tap Analyse now to go on.",
        internalError:
          "Something went wrong inside the app during the analysis. The finds are kept. Tap Analyse now to try again.",
        other: "The Claude API answered with status {status}. Tap Analyse now to try again.",
      },
      failed: {
        segmentCheck: {
          app0: "The photo holds an APP0 segment that is not plain JFIF, such as a JFIF extension, which can carry a small copy of the image with data of its own. It is not sent, so the photo was not analysed.",
          app1: "The photo holds camera data or other metadata (EXIF or XMP, the APP1 segment) that is not sent, so it was not analysed.",
          app2: "The photo holds something other than a colour profile in its APP2 segment, such as an index of further images, which is not sent, so it was not analysed.",
          app13:
            "The photo holds IPTC data (the APP13 segment), such as a caption or a place, which is not sent, so it was not analysed.",
          otherApp:
            "The photo holds application data (the APP{number} segment) that is not sent, so it was not analysed.",
          comment:
            "The photo holds a comment (the COM segment) that is not sent, so it was not analysed.",
          otherMarker: "The photo holds a part the app does not send, so it was not analysed.",
          trailingData:
            "The photo has more data after the end of the image, such as a further image, which is not sent, so it was not analysed.",
          truncated: "The photo prepared for analysis is cut short, so it was not analysed.",
          malformed:
            "The photo prepared for analysis is not a well-formed JPEG, so it was not analysed.",
          notJpeg: "The photo prepared for analysis is not a JPEG, so it was not analysed.",
          invalidInput:
            "The photo prepared for analysis could not be checked, so it was not analysed.",
          unknown: "The photo holds data that is not sent, so it was not analysed.",
        },
        photo: {
          loadFailed:
            "The photo could not be loaded for analysis. Its file may be missing or damaged, or the phone may be short of memory.",
          invalidSize:
            "The photo's size could not be read, so it could not be prepared for analysis.",
          unknown: "The photo could not be read for analysis.",
        },
        request: {
          wrong: "The Claude API refused the request as not valid.",
          tooLarge: "The Claude API refused the request as too large.",
          unknown: "The Claude API refused the request.",
        },
        answer: {
          notApi: "The answer did not come from the Claude API, for example a Wi-Fi sign-in page.",
          cutOff: "Claude's answer was cut off before it was complete.",
          shape: "Claude's answer did not have the form the app expects.",
        },
        refused: "Claude declined to analyse this photo.",
        refusedDescribed: "Claude declined to analyse this description.",
        numbered: "Photo {number}: {reason} You can remove that photo and analyse the find again.",
      },
      answerKept: "The new analysis failed. The earlier answer is kept.",
    },
    find: {
      title: "Find",
      notFound: "This find does not exist. It may have been deleted.",
      unreadable: "This find could not be read.",
      back: "Back to Finds",
      photo: "Photo of the find",
      photoNumbered: "Photo {number} of {count} of the find",
      addPhotos: "Add photos",
      maxPhotos: "The find holds {max} photos, as many as it can.",
      removePhoto: "Remove photo {number}",
      removePhotoConfirm:
        "Remove photo {number} from the find? Only the app's copy is removed; a photo in the phone's gallery or files stays there.",
      removePhotoYes: "Remove",
      removePhotoCancel: "Keep the photo",
      removePhotoFailed: "The photo could not be removed. Try again.",
      addedPhotos: {
        waiting:
          "The photos added since this answer wait for analysis. The answer is kept until a new one replaces it.",
        notAnalysed:
          "The photos added since this answer could not be analysed. Analyse again to analyse the find with all its photos.",
      },
      latin: "Latin",
      edibility: "Edibility of the matched species: {edibility}",
      lookAlikeEdibility: "Edibility of this species: {edibility}",
      edibilities: {
        edible: "Edible",
        edibleAfterPreparation: "Edible only after preparation",
        notEdible: "Not edible",
        poisonous: "Poisonous",
        deadlyPoisonous: "Deadly poisonous",
        unknown: "Unknown",
      },
      confidence: "Claude's confidence in the match: {confidence}",
      confidenceScore: "{score} of 100",
      confidences: {
        low: "low",
        medium: "medium",
        high: "high",
      },
      confidenceNote: "This is Claude's own statement, not a measured probability.",
      generalInformation: "About the species",
      lookAlikes: "Poisonous look-alikes",
      noLookAlikes: "Claude named no poisonous look-alikes.",
      noMushroom: "Claude sees no mushroom in the photo.",
      cannotTell: "Claude sees a mushroom but cannot tell which species it is.",
      noMushroomDescribed: "The description is not of a mushroom.",
      cannotTellDescribed: "The description does not say enough to tell which species it is.",
      description: "Your description",
      selfCheck: {
        waiting:
          "The edibility is shown as unknown until a check on a picture of the species agrees with this match. The check has not been made yet.",
        disagreed:
          "The edibility is shown as unknown: a check on a picture of {matched} named another species, {named}.",
        noSpecies:
          "The edibility is shown as unknown: a check on a picture of the species could not name a species.",
        failed: "The edibility is shown as unknown: the check on a picture of the species failed.",
        noPicture:
          "The edibility is shown as unknown: no picture of the species was found for the check.",
      },
      waiting: "This find waits for analysis.",
      failed: "The analysis failed.",
      time: "Taken: {time}",
      timeSources: {
        saved: "The time is when the find was saved.",
        photo: "The time comes from the photo's metadata.",
        photoPhoneOffset:
          "The time comes from the photo's metadata, which gives no UTC offset. It is read with the phone's offset on that date.",
      },
      position: "Position: {coordinates}",
      accuracy: "Accurate to about {metres} m",
      positionSources: {
        fix: "The position is a fix from the phone.",
        lastKnown: "The position is the phone's last known position.",
        photo: "The position comes from the photo's metadata.",
      },
      noPosition: "This find has no position.",
      openMap: "Open in the map app",
      mapFailed: "No map app could open the position.",
      analyse: "Analyse this find now",
      analyseAgain: "Analyse again",
      analysing: "Analysing…",
      analysisError:
        "The analysis could not run because of an error in the app. The find is as it was.",
      delete: "Delete the find",
      deleteConfirm: "Delete this find and its photo? This cannot be undone.",
      deleteConfirmDescribed: "Delete this find? This cannot be undone.",
      deleteYes: "Delete",
      deleteCancel: "Cancel",
      deleteFailed: "The find could not be deleted. Try again.",
    },
    about: {
      title: "About",
      appHeading: "The app's licence",
      librariesHeading: "Libraries",
      librariesIntro: "The app contains these libraries, under their own licences.",
      versionNotPinned: "chosen when the app is built",
      showText: "Show the licence text",
      hideText: "Hide the licence text",
      textMissing: "The licence text is not in the app yet.",
      disclaimerHeading: "Edibility",
    },
  },
  // Not checked by an Italian speaker, but for the disclaimer (NOT_CHECKED_BY_A_SPEAKER).
  it: {
    languageName: "Italiano",
    disclaimer:
      "La commestibilità indicata è quella della specie individuata dall'app. Non c'è alcuna garanzia che il fungo nella tua foto sia di quella specie.",
    disclaimerDescribed:
      "La commestibilità indicata è quella della specie individuata dall'app. Non c'è alcuna garanzia che il fungo che hai descritto sia di quella specie.",
    firstStart: {
      title: "Prima di iniziare",
      accept: "Accetta",
    },
    log: {
      title: "Ritrovamenti",
      empty: "Ancora nessun ritrovamento.",
      newFind: "Nuovo ritrovamento",
      textLookup: "Descrivi un fungo",
      settings: "Impostazioni",
      waiting: "In attesa di analisi",
      failed: "Analisi non riuscita",
      unreadable: "Non è stato possibile leggere il registro dei ritrovamenti.",
      retry: "Riprova",
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
      lookups: {
        heading: "Ricerche",
        textSave: "Salva è attivo all'inizio di una ricerca testuale",
        photoSave: "Salva è attivo all'inizio di una ricerca con foto",
        saveFailed: "Non è stato possibile salvare l'impostazione. Riprova.",
      },
    },
    notFound: {
      title: "Non trovata",
      message: "Questa pagina non esiste.",
      back: "Torna a Ritrovamenti",
    },
    newFind: {
      title: "Nuovo ritrovamento",
      asking:
        "L'app chiede di usare la fotocamera, per scattare la foto, e la posizione del telefono, per annotare dove è stato fatto il ritrovamento.",
      takePhoto: "Scatta una foto",
      pickFromGallery: "Scegli una foto dalla galleria",
      saving: "Salvataggio della foto…",
      saved: "La foto è salvata nel ritrovamento.",
      addTitle: "Aggiungi foto",
      photoCount: "Il ritrovamento ha {count} foto su un massimo di {max}.",
      maxReached: "Il ritrovamento ha il numero massimo di foto.",
      analyse: "Analizza",
      analyseFailed: "Non è stato possibile inviare le foto all'analisi. Riprova.",
      findUnavailable:
        "Non è stato possibile aprire il ritrovamento, quindi non si possono aggiungere foto.",
      saveFailed: "Non è stato possibile salvare la foto. Riprova.",
      retrySave: "Salva di nuovo",
      discardPhoto: "Scarta la foto",
      discardConfirm: "Scartare la foto? Non è stata salvata e non si potrà recuperare.",
      discardYes: "Scarta",
      discardCancel: "Tieni la foto",
      leaveConfirm: "Uscire e scartare la foto? Non è stata salvata e non si potrà recuperare.",
      leaveYes: "Scarta ed esci",
      leaveCancel: "Resta",
      pickFailed: "Non è stato possibile scattare o scegliere la foto. Riprova.",
      cameraDenied:
        "L'app non può usare la fotocamera, quindi non può scattare foto. Puoi invece scegliere una foto dalla galleria.",
      cameraBlocked:
        "L'app non può usare la fotocamera. Puoi consentirlo nelle impostazioni del telefono, oppure scegliere una foto dalla galleria.",
      locationDenied:
        "L'app non può usare la posizione del telefono, quindi una foto dalla fotocamera viene salvata senza posizione. Puoi consentirlo nelle impostazioni del telefono.",
      openSettings: "Apri le impostazioni del telefono",
      save: "Salva",
      saveHint:
        "Con Salva attivo, la ricerca diventa un ritrovamento nel registro e ogni foto viene salvata appena scattata o scelta. Con Salva disattivato, le foto restano solo in questa pagina, vengono analizzate qui ed eliminate quando la lasci.",
      heldCount: "La ricerca ha {count} foto su un massimo di {max}, solo in questa pagina.",
      heldMaxReached: "La ricerca ha il numero massimo di foto di un ritrovamento.",
      analysing: "Analisi in corso…",
      analysisError: "Non è stato possibile eseguire l'analisi per un errore nell'app.",
      turnSaveOn: "Attiva Salva, così la ricerca resta in coda",
      leaveLookupConfirm:
        "Uscire e scartare la ricerca? Non è stata salvata e non si potrà recuperare.",
      savePhotosFailed: "Non è stato possibile salvare le foto. Riprova.",
      discardPhotos: "Scarta le foto",
      discardPhotosConfirm:
        "Scartare le foto? Non sono state salvate e non si potranno recuperare.",
      discardPhotosCancel: "Tieni le foto",
      leavePhotosConfirm:
        "Uscire e scartare le foto? Non sono state salvate e non si potranno recuperare.",
    },
    lookup: {
      title: "Descrivi un fungo",
      asking:
        "L'app chiede di usare la posizione del telefono, per annotare dove è stata fatta una ricerca salvata.",
      input: "La tua descrizione del fungo",
      count: "{count} di {max} caratteri",
      save: "Salva",
      saveHint:
        "Con Salva attivo, la ricerca diventa un ritrovamento nel registro e lì resta in attesa di analisi.",
      analyse: "Analizza",
      analysing: "Analisi in corso…",
      saving: "Salvataggio del ritrovamento…",
      empty: "Scrivi prima una descrizione.",
      saveFailed: "Non è stato possibile salvare il ritrovamento. Riprova.",
      turnSaveOn: "Attiva Salva, così la ricerca resta in coda",
      analysisError: "Non è stato possibile eseguire l'analisi per un errore nell'app.",
      leaveConfirm: "Uscire e scartare la ricerca? Non è stata salvata e non si potrà recuperare.",
      leaveYes: "Scarta ed esci",
      leaveCancel: "Resta",
      locationDenied:
        "L'app non può usare la posizione del telefono, quindi una ricerca salvata non avrà una posizione. Puoi consentirlo nelle impostazioni del telefono.",
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
        keyNotScoped:
          "La chiave non appartiene a nessuno spazio di lavoro e l'app non può indicarne uno. Sostituiscila in Impostazioni con una chiave che appartiene a uno spazio di lavoro.",
        noCredit:
          "L'account della chiave non ha più credito. Aggiungi credito, poi tocca Analizza ora.",
        modelUnknown: "L'API di Claude non conosce il modello. Scegline un altro in Impostazioni.",
        answer:
          "Una risposta non aveva la forma prevista, oppure non veniva dall'API di Claude (ad esempio una pagina di accesso al Wi-Fi). Quel ritrovamento è segnato come non riuscito. Tocca Analizza ora per continuare.",
        internalError:
          "Qualcosa è andato storto nell'app durante l'analisi. I ritrovamenti sono conservati. Tocca Analizza ora per riprovare.",
        other:
          "L'API di Claude ha risposto con lo stato {status}. Tocca Analizza ora per riprovare.",
      },
      failed: {
        segmentCheck: {
          app0: "La foto contiene un segmento APP0 che non è JFIF semplice, ad esempio un'estensione JFIF, che può portare una piccola copia dell'immagine con dati propri. Non viene inviato, quindi la foto non è stata analizzata.",
          app1: "La foto contiene dati della fotocamera o altri metadati (EXIF o XMP, il segmento APP1) che non vengono inviati, quindi non è stata analizzata.",
          app2: "La foto contiene nel suo segmento APP2 qualcosa di diverso da un profilo colore, ad esempio un indice di altre immagini, che non viene inviato, quindi non è stata analizzata.",
          app13:
            "La foto contiene dati IPTC (il segmento APP13), ad esempio una didascalia o un luogo, che non vengono inviati, quindi non è stata analizzata.",
          otherApp:
            "La foto contiene dati di un'applicazione (il segmento APP{number}) che non vengono inviati, quindi non è stata analizzata.",
          comment:
            "La foto contiene un commento (il segmento COM) che non viene inviato, quindi non è stata analizzata.",
          otherMarker:
            "La foto contiene una parte che l'app non invia, quindi non è stata analizzata.",
          trailingData:
            "La foto ha altri dati dopo la fine dell'immagine, ad esempio un'altra immagine, che non vengono inviati, quindi non è stata analizzata.",
          truncated: "La foto preparata per l'analisi è incompleta, quindi non è stata analizzata.",
          malformed:
            "La foto preparata per l'analisi non è un JPEG ben formato, quindi non è stata analizzata.",
          notJpeg: "La foto preparata per l'analisi non è un JPEG, quindi non è stata analizzata.",
          invalidInput:
            "Non è stato possibile controllare la foto preparata per l'analisi, quindi non è stata analizzata.",
          unknown: "La foto contiene dati che non vengono inviati, quindi non è stata analizzata.",
        },
        photo: {
          loadFailed:
            "Non è stato possibile caricare la foto per l'analisi. Il file potrebbe mancare o essere danneggiato, oppure il telefono potrebbe avere poca memoria.",
          invalidSize:
            "Non è stato possibile leggere le dimensioni della foto, quindi non è stato possibile prepararla per l'analisi.",
          unknown: "Non è stato possibile leggere la foto per l'analisi.",
        },
        request: {
          wrong: "L'API di Claude ha rifiutato la richiesta come non valida.",
          tooLarge: "L'API di Claude ha rifiutato la richiesta come troppo grande.",
          unknown: "L'API di Claude ha rifiutato la richiesta.",
        },
        answer: {
          notApi:
            "La risposta non veniva dall'API di Claude, ad esempio una pagina di accesso al Wi-Fi.",
          cutOff: "La risposta di Claude si è interrotta prima di essere completa.",
          shape: "La risposta di Claude non aveva la forma che l'app si aspetta.",
        },
        refused: "Claude ha rifiutato di analizzare questa foto.",
        refusedDescribed: "Claude ha rifiutato di analizzare questa descrizione.",
        numbered:
          "Foto {number}: {reason} Puoi rimuovere quella foto e analizzare di nuovo il ritrovamento.",
      },
      answerKept: "La nuova analisi non è riuscita. La risposta precedente è mantenuta.",
    },
    find: {
      title: "Ritrovamento",
      notFound: "Questo ritrovamento non esiste. Potrebbe essere stato eliminato.",
      unreadable: "Non è stato possibile leggere questo ritrovamento.",
      back: "Torna a Ritrovamenti",
      photo: "Foto del ritrovamento",
      photoNumbered: "Foto {number} di {count} del ritrovamento",
      addPhotos: "Aggiungi foto",
      maxPhotos: "Il ritrovamento ha {max} foto, il massimo possibile.",
      removePhoto: "Rimuovi la foto {number}",
      removePhotoConfirm:
        "Rimuovere la foto {number} dal ritrovamento? Viene rimossa solo la copia dell'app; una foto nella galleria o nei file del telefono resta lì.",
      removePhotoYes: "Rimuovi",
      removePhotoCancel: "Tieni la foto",
      removePhotoFailed: "Non è stato possibile rimuovere la foto. Riprova.",
      addedPhotos: {
        waiting:
          "Le foto aggiunte dopo questa risposta sono in attesa di analisi. La risposta resta finché una nuova non la sostituisce.",
        notAnalysed:
          "Non è stato possibile analizzare le foto aggiunte dopo questa risposta. Analizza di nuovo per analizzare il ritrovamento con tutte le sue foto.",
      },
      latin: "Latino",
      edibility: "Commestibilità della specie individuata: {edibility}",
      lookAlikeEdibility: "Commestibilità di questa specie: {edibility}",
      edibilities: {
        edible: "Commestibile",
        edibleAfterPreparation: "Commestibile solo dopo la preparazione",
        notEdible: "Non commestibile",
        poisonous: "Velenosa",
        deadlyPoisonous: "Mortalmente velenosa",
        unknown: "Sconosciuta",
      },
      confidence: "Sicurezza di Claude sulla corrispondenza: {confidence}",
      confidenceScore: "{score} su 100",
      confidences: {
        low: "bassa",
        medium: "media",
        high: "alta",
      },
      confidenceNote: "È una dichiarazione di Claude stesso, non una probabilità misurata.",
      generalInformation: "Sulla specie",
      lookAlikes: "Specie velenose simili",
      noLookAlikes: "Claude non ha indicato specie velenose simili.",
      noMushroom: "Claude non vede alcun fungo nella foto.",
      cannotTell: "Claude vede un fungo ma non sa dire di quale specie si tratti.",
      noMushroomDescribed: "La descrizione non è di un fungo.",
      cannotTellDescribed:
        "La descrizione non dice abbastanza per stabilire di quale specie si tratti.",
      description: "La tua descrizione",
      selfCheck: {
        waiting:
          "La commestibilità è indicata come sconosciuta finché un controllo su un'immagine della specie non conferma questa corrispondenza. Il controllo non è ancora stato fatto.",
        disagreed:
          "La commestibilità è indicata come sconosciuta: un controllo su un'immagine di {matched} ha indicato un'altra specie, {named}.",
        noSpecies:
          "La commestibilità è indicata come sconosciuta: un controllo su un'immagine della specie non ha potuto indicare una specie.",
        failed:
          "La commestibilità è indicata come sconosciuta: il controllo su un'immagine della specie non è riuscito.",
        noPicture:
          "La commestibilità è indicata come sconosciuta: non è stata trovata nessuna immagine della specie per il controllo.",
      },
      waiting: "Questo ritrovamento è in attesa di analisi.",
      failed: "L'analisi non è riuscita.",
      time: "Data e ora: {time}",
      timeSources: {
        saved: "L'ora è quella in cui il ritrovamento è stato salvato.",
        photo: "L'ora proviene dai metadati della foto.",
        photoPhoneOffset:
          "L'ora proviene dai metadati della foto, che non indicano lo scarto da UTC. È letta con lo scarto del telefono in quella data.",
      },
      position: "Posizione: {coordinates}",
      accuracy: "Precisione di circa {metres} m",
      positionSources: {
        fix: "La posizione è un rilevamento del telefono.",
        lastKnown: "La posizione è l'ultima posizione nota del telefono.",
        photo: "La posizione proviene dai metadati della foto.",
      },
      noPosition: "Questo ritrovamento non ha una posizione.",
      openMap: "Apri nell'app delle mappe",
      mapFailed: "Nessuna app delle mappe ha potuto aprire la posizione.",
      analyse: "Analizza ora questo ritrovamento",
      analyseAgain: "Analizza di nuovo",
      analysing: "Analisi in corso…",
      analysisError:
        "Non è stato possibile eseguire l'analisi per un errore nell'app. Il ritrovamento è com'era.",
      delete: "Elimina il ritrovamento",
      deleteConfirm: "Eliminare il ritrovamento e la sua foto? L'operazione non si può annullare.",
      deleteConfirmDescribed: "Eliminare il ritrovamento? L'operazione non si può annullare.",
      deleteYes: "Elimina",
      deleteCancel: "Annulla",
      deleteFailed: "Non è stato possibile eliminare il ritrovamento. Riprova.",
    },
    about: {
      title: "Informazioni",
      appHeading: "La licenza dell'app",
      librariesHeading: "Librerie",
      librariesIntro: "L'app contiene queste librerie, con le loro licenze.",
      versionNotPinned: "scelta quando l'app viene compilata",
      showText: "Mostra il testo della licenza",
      hideText: "Nascondi il testo della licenza",
      textMissing: "Il testo della licenza non è ancora nell'app.",
      disclaimerHeading: "Commestibilità",
    },
  },
};
