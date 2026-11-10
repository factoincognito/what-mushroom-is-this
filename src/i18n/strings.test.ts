import { LANGUAGES } from "./languages";
import { NOT_CHECKED_BY_A_SPEAKER, STRINGS } from "./strings";

/** The UTF-8 bytes of a string, in hex. */
function utf8Hex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Every key path of a nested strings object, sorted, such as "log.title". */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }
  return Object.entries(value)
    .flatMap(([key, child]) => keyPaths(child, prefix === "" ? key : `${prefix}.${key}`))
    .sort();
}

/** Every leaf value of a nested strings object. */
function leaves(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) {
    return [value];
  }
  return Object.values(value).flatMap(leaves);
}

describe("STRINGS", () => {
  it("has the strings of exactly the three app languages", () => {
    expect(Object.keys(STRINGS).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES)("has the same keys in %s as in English", (language) => {
    expect(keyPaths(STRINGS[language])).toEqual(keyPaths(STRINGS.en));
  });

  it.each(LANGUAGES)("has only non-empty strings in %s", (language) => {
    for (const leaf of leaves(STRINGS[language])) {
      expect(typeof leaf).toBe("string");
      expect(leaf).not.toBe("");
    }
  });

  it("names each language in that language", () => {
    expect(STRINGS.sv.languageName).toBe("Svenska");
    expect(STRINGS.en.languageName).toBe("English");
    expect(STRINGS.it.languageName).toBe("Italiano");
  });
});

/** Whether an entry of NOT_CHECKED_BY_A_SPEAKER covers a key path: the path itself or a group. */
function covers(entry: string, path: string): boolean {
  return path === entry || path.startsWith(`${entry}.`);
}

describe("NOT_CHECKED_BY_A_SPEAKER", () => {
  const UNCHECKED = [
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
  ];

  it("marks the Swedish and the Italian strings of PBI-1.1, PBI-1.2, PBI-1.6, PBI-1.7, PBI-1.8, PBI-1.9 and PBI-2.4", () => {
    expect(NOT_CHECKED_BY_A_SPEAKER).toEqual({ sv: UNCHECKED, it: UNCHECKED });
  });

  it.each(["sv", "it"] as const)("names in %s only strings that exist", (language) => {
    const paths = keyPaths(STRINGS[language]);
    for (const entry of NOT_CHECKED_BY_A_SPEAKER[language]) {
      expect(paths.some((path) => covers(entry, path))).toBe(true);
    }
  });

  it.each(["sv", "it"] as const)("covers every string in %s but the disclaimer", (language) => {
    const uncovered = keyPaths(STRINGS[language]).filter(
      (path) => !NOT_CHECKED_BY_A_SPEAKER[language].some((entry) => covers(entry, path)),
    );
    expect(uncovered).toEqual(["disclaimer"]);
  });

  it("does not mark the disclaimer, the approved text of SPEC 3.5, which an Italian speaker checked", () => {
    for (const entry of [...NOT_CHECKED_BY_A_SPEAKER.sv, ...NOT_CHECKED_BY_A_SPEAKER.it]) {
      expect(covers(entry, "disclaimer")).toBe(false);
    }
  });
});

describe("the strings of the representative picture (SPEC 3.9; PBI-2.9)", () => {
  it.each(LANGUAGES)(
    "in %s, name Wikimedia Commons as the source, and fill in the species, author and licence",
    (language) => {
      const t = STRINGS[language].find.picture;
      expect(t.caption).toContain("Wikimedia Commons");
      expect(t.label).toContain("Wikimedia Commons");
      expect(t.page).toContain("Wikimedia Commons");
      expect(t.label).toContain("{name}");
      expect(t.author).toContain("{author}");
      expect(t.licence).toContain("{licence}");
      expect(STRINGS[language].queue.paused.pictureSource).toContain("Wikimedia Commons");
      expect(STRINGS[language].lookup.pictureWaits).toContain("Wikimedia Commons");
    },
  );

  it("say in English that the picture is of the species, not of the user's mushroom, and was resized", () => {
    const t = STRINGS.en.find.picture;
    expect(t.caption).toBe(
      "A picture of the species from Wikimedia Commons, not of your mushroom.",
    );
    expect(t.label).toBe(
      "Picture of the species {name} from Wikimedia Commons, not of your mushroom",
    );
    expect(t.resized).toBe("Resized by the app.");
    expect(STRINGS.en.lookup.checkAgain).toBe("Check again");
  });

  it("say in English that a find with no usable picture could not be checked, also when one was found but not used (Clead, #71)", () => {
    expect(STRINGS.en.find.selfCheck.noPicture).toBe(
      "The edibility is shown as unknown: the find could not be checked, as no usable picture of the species was found.",
    );
  });

  it.each([
    ["sv", /användbar bild/, /kunde inte kontrolleras/],
    ["it", /immagine utilizzabile/, /non è stato possibile controllare/],
  ] as const)("say it in %s too", (language, usable, notChecked) => {
    const text = STRINGS[language].find.selfCheck.noPicture;
    expect(text).toMatch(usable);
    expect(text).toMatch(notChecked);
  });

  it("are new strings in groups not checked by a speaker in Swedish and Italian", () => {
    for (const language of ["sv", "it"] as const) {
      expect(NOT_CHECKED_BY_A_SPEAKER[language]).toEqual(
        expect.arrayContaining(["find", "lookup", "queue"]),
      );
    }
  });
});

describe("the strings of the key and model settings", () => {
  it.each(LANGUAGES)("are all there in %s", (language) => {
    const paths = keyPaths(STRINGS[language]);
    expect(paths.filter((path) => path.startsWith("settings.key."))).toEqual([
      "settings.key.empty",
      "settings.key.heading",
      "settings.key.input",
      "settings.key.none",
      "settings.key.notSendable",
      "settings.key.remove",
      "settings.key.removeFailed",
      "settings.key.removed",
      "settings.key.save",
      "settings.key.saveFailed",
      "settings.key.saved",
      "settings.key.stored",
      "settings.key.unreadable",
    ]);
    expect(paths.filter((path) => path.startsWith("settings.model."))).toEqual([
      "settings.model.default",
      "settings.model.empty",
      "settings.model.heading",
      "settings.model.inUse",
      "settings.model.input",
      "settings.model.invalid",
      "settings.model.save",
      "settings.model.saveFailed",
      "settings.model.saved",
    ]);
  });
});

describe("the strings of the new find", () => {
  it.each(LANGUAGES)("are all there in %s", (language) => {
    expect(keyPaths(STRINGS[language]).filter((path) => path.startsWith("newFind."))).toEqual([
      "newFind.addTitle",
      "newFind.analyse",
      "newFind.analyseFailed",
      "newFind.analysing",
      "newFind.analysisError",
      "newFind.asking",
      "newFind.cameraBlocked",
      "newFind.cameraDenied",
      "newFind.discardCancel",
      "newFind.discardConfirm",
      "newFind.discardPhoto",
      "newFind.discardPhotos",
      "newFind.discardPhotosCancel",
      "newFind.discardPhotosConfirm",
      "newFind.discardYes",
      "newFind.fileNotImage",
      "newFind.findUnavailable",
      "newFind.heldCount",
      "newFind.heldMaxReached",
      "newFind.heldPhoto",
      "newFind.leaveCancel",
      "newFind.leaveConfirm",
      "newFind.leaveLookupConfirm",
      "newFind.leavePhotosConfirm",
      "newFind.leaveYes",
      "newFind.locationDenied",
      "newFind.maxReached",
      "newFind.openSettings",
      "newFind.photoCount",
      "newFind.pickFailed",
      "newFind.pickFromFiles",
      "newFind.pickFromGallery",
      "newFind.removeHeldConfirm",
      "newFind.retrySave",
      "newFind.save",
      "newFind.saveFailed",
      "newFind.saveHint",
      "newFind.savePhotosFailed",
      "newFind.saved",
      "newFind.saving",
      "newFind.takePhoto",
      "newFind.title",
      "newFind.turnSaveOn",
    ]);
  });

  it.each(LANGUAGES)(
    "fill in the count and the most of the photos an unsaved lookup holds, in %s (PBI-2.13)",
    (language) => {
      const { heldCount, heldPhoto, removeHeldConfirm } = STRINGS[language].newFind;
      expect(heldCount).toContain("{count}");
      expect(heldCount).toContain("{max}");
      expect(heldPhoto).toContain("{number}");
      expect(heldPhoto).toContain("{count}");
      expect(removeHeldConfirm).toContain("{number}");
    },
  );

  it("say in English that an unsaved lookup's photos are held on the screen only, and the plural questions speak of the photos (PBI-2.13)", () => {
    const t = STRINGS.en.newFind;
    expect(t.saveHint).toMatch(/Save off/);
    expect(t.heldCount).toMatch(/on this screen only/);
    expect(t.leaveLookupConfirm).toMatch(/lookup/);
    expect(t.discardPhotosConfirm).toMatch(/photos/);
    expect(t.leavePhotosConfirm).toMatch(/photos/);
    expect(t.removeHeldConfirm).toMatch(/lookup\? Only the app's copy is removed/);
  });
});

describe("the photo load-failure sentence (PBI-1.26)", () => {
  it.each([
    ["sv", /minne/],
    ["en", /memory/],
    ["it", /memoria/],
  ] as const)(
    "names in %s a phone short of memory beside a missing or damaged file, as Android gives no reason",
    (language, memory) => {
      expect(STRINGS[language].queue.failed.photo.loadFailed).toMatch(memory);
    },
  );
});

describe("the strings of the queue (PBI-1.7)", () => {
  it.each(LANGUAGES)("are all there in %s", (language) => {
    expect(keyPaths(STRINGS[language]).filter((path) => path.startsWith("queue."))).toEqual([
      "queue.analyseNow",
      "queue.answerKept",
      "queue.failed.answer.cutOff",
      "queue.failed.answer.notApi",
      "queue.failed.answer.shape",
      "queue.failed.numbered",
      "queue.failed.photo.invalidSize",
      "queue.failed.photo.loadFailed",
      "queue.failed.photo.unknown",
      "queue.failed.refused",
      "queue.failed.refusedDescribed",
      "queue.failed.request.tooLarge",
      "queue.failed.request.unknown",
      "queue.failed.request.wrong",
      "queue.failed.segmentCheck.app0",
      "queue.failed.segmentCheck.app1",
      "queue.failed.segmentCheck.app13",
      "queue.failed.segmentCheck.app2",
      "queue.failed.segmentCheck.comment",
      "queue.failed.segmentCheck.invalidInput",
      "queue.failed.segmentCheck.malformed",
      "queue.failed.segmentCheck.notJpeg",
      "queue.failed.segmentCheck.otherApp",
      "queue.failed.segmentCheck.otherMarker",
      "queue.failed.segmentCheck.trailingData",
      "queue.failed.segmentCheck.truncated",
      "queue.failed.segmentCheck.unknown",
      "queue.openSettings",
      "queue.paused.network",
      "queue.paused.pictureSource",
      "queue.paused.server",
      "queue.paused.timeOut",
      "queue.running",
      "queue.stopped.answer",
      "queue.stopped.internalError",
      "queue.stopped.keyNotScoped",
      "queue.stopped.keyRefused",
      "queue.stopped.modelUnknown",
      "queue.stopped.noCredit",
      "queue.stopped.noKey",
      "queue.stopped.other",
      "queue.stopped.rateLimited",
      "queue.stopped.rateLimitedUntil",
      "queue.stopped.spendLimitUntil",
    ]);
  });
});

describe("the strings of the Log and Find screens (PBI-1.8)", () => {
  it.each(LANGUAGES)("are all there in %s", (language) => {
    const paths = keyPaths(STRINGS[language]);
    expect(paths.filter((path) => path.startsWith("log."))).toEqual([
      "log.allMonths",
      "log.allSpecies",
      "log.allYears",
      "log.empty",
      "log.failed",
      "log.filters",
      "log.filtersOn",
      "log.listView",
      "log.mapFailed",
      "log.mapOpening",
      "log.mapView",
      "log.months",
      "log.newFind",
      "log.noMatch",
      "log.notIdentified",
      "log.retry",
      "log.settings",
      "log.species",
      "log.textLookup",
      "log.textMark",
      "log.textMarkLabel",
      "log.title",
      "log.unreadable",
      "log.waiting",
      "log.years",
    ]);
    expect(paths.filter((path) => path.startsWith("find."))).toEqual([
      "find.accuracy",
      "find.addPhotos",
      "find.addedPhotos.notAnalysed",
      "find.addedPhotos.waiting",
      "find.analyse",
      "find.analyseAgain",
      "find.analysing",
      "find.analysisError",
      "find.back",
      "find.cannotTell",
      "find.cannotTellDescribed",
      "find.confidence",
      "find.confidenceNote",
      "find.confidenceScore",
      "find.confidences.high",
      "find.confidences.low",
      "find.confidences.medium",
      "find.delete",
      "find.deleteCancel",
      "find.deleteConfirm",
      "find.deleteConfirmDescribed",
      "find.deleteFailed",
      "find.deleteYes",
      "find.description",
      "find.edibilities.deadlyPoisonous",
      "find.edibilities.edible",
      "find.edibilities.edibleAfterPreparation",
      "find.edibilities.notEdible",
      "find.edibilities.poisonous",
      "find.edibilities.unknown",
      "find.edibility",
      "find.failed",
      "find.generalInformation",
      "find.latin",
      "find.lookAlikeEdibility",
      "find.lookAlikes",
      "find.mapFailed",
      "find.maxPhotos",
      "find.noLookAlikes",
      "find.noMushroom",
      "find.noMushroomDescribed",
      "find.noPosition",
      "find.notFound",
      "find.openMap",
      "find.photo",
      "find.photoNumbered",
      "find.picture.author",
      "find.picture.caption",
      "find.picture.label",
      "find.picture.licence",
      "find.picture.linkFailed",
      "find.picture.page",
      "find.picture.publicDomain",
      "find.picture.resized",
      "find.position",
      "find.positionSources.fix",
      "find.positionSources.lastKnown",
      "find.positionSources.photo",
      "find.removePhoto",
      "find.removePhotoCancel",
      "find.removePhotoConfirm",
      "find.removePhotoFailed",
      "find.removePhotoYes",
      "find.selfCheck.disagreed",
      "find.selfCheck.failed",
      "find.selfCheck.noPicture",
      "find.selfCheck.noSpecies",
      "find.selfCheck.waiting",
      "find.time",
      "find.timeSources.photo",
      "find.timeSources.photoPhoneOffset",
      "find.timeSources.saved",
      "find.title",
      "find.unreadable",
      "find.waiting",
    ]);
  });

  it.each(LANGUAGES)(
    "label the edibility in %s as that of a species, with a place for it",
    (lang) => {
      expect(STRINGS[lang].find.edibility).toContain("{edibility}");
      expect(STRINGS[lang].find.lookAlikeEdibility).toContain("{edibility}");
      expect(STRINGS[lang].find.confidence).toContain("{confidence}");
      expect(STRINGS[lang].find.confidenceScore).toContain("{score}");
      expect(STRINGS[lang].find.confidenceScore).toContain("100");
      expect(STRINGS[lang].find.time).toContain("{time}");
      expect(STRINGS[lang].find.position).toContain("{coordinates}");
      expect(STRINGS[lang].find.accuracy).toContain("{metres}");
    },
  );
});

describe("the Library in place of the Log (SPEC 3.9, PBI-2.7)", () => {
  it("names it the Library in English, wherever the Log or Finds was named", () => {
    const t = STRINGS.en;
    expect(t.log.title).toBe("Library");
    expect(t.log.unreadable).toBe("The Library could not be read.");
    expect(t.notFound.back).toBe("Back to the Library");
    expect(t.find.back).toBe("Back to the Library");
    expect(t.lookup.saveHint).toMatch(/a find in the Library/);
    expect(t.newFind.saveHint).toMatch(/a find in the Library/);
  });

  it.each([
    ["sv", "Bibliotek", /Biblioteket/, /logg|Fynd\b/],
    ["en", "Library", /Library/, /\blog\b|Finds/],
    ["it", "Biblioteca", /Biblioteca/, /registro|Ritrovamenti/],
  ] as const)(
    "names it in %s as %s, and nowhere the Log any longer",
    (language, title, named, log) => {
      const t = STRINGS[language];
      expect(t.log.title).toBe(title);
      for (const text of [
        t.log.unreadable,
        t.notFound.back,
        t.find.back,
        t.lookup.saveHint,
        t.newFind.saveHint,
      ]) {
        expect(text).toMatch(named);
        expect(text).not.toMatch(log);
      }
    },
  );

  it("are new strings, not checked by a speaker in Swedish and Italian", () => {
    expect(NOT_CHECKED_BY_A_SPEAKER.sv).toContain("log");
    expect(NOT_CHECKED_BY_A_SPEAKER.it).toContain("log");
  });
});

describe("the strings of the About view", () => {
  it.each(LANGUAGES)("are all there in %s", (language) => {
    expect(keyPaths(STRINGS[language]).filter((path) => path.startsWith("about."))).toEqual([
      "about.appHeading",
      "about.creditsHeading",
      "about.disclaimerHeading",
      "about.hideText",
      "about.librariesHeading",
      "about.librariesIntro",
      "about.mapDataHeading",
      "about.mapDataIntro",
      "about.showText",
      "about.textMissing",
      "about.title",
      "about.versionNotPinned",
    ]);
  });
});

describe("the strings of the text lookup (PBI-2.4)", () => {
  it.each(LANGUAGES)("are all there in %s", (language) => {
    const paths = keyPaths(STRINGS[language]);
    expect(paths.filter((path) => path.startsWith("lookup."))).toEqual([
      "lookup.analyse",
      "lookup.analysing",
      "lookup.analysisError",
      "lookup.asking",
      "lookup.checkAgain",
      "lookup.count",
      "lookup.empty",
      "lookup.input",
      "lookup.leaveCancel",
      "lookup.leaveConfirm",
      "lookup.leaveYes",
      "lookup.locationDenied",
      "lookup.openSettings",
      "lookup.pictureError",
      "lookup.pictureFetching",
      "lookup.pictureWaits",
      "lookup.save",
      "lookup.saveFailed",
      "lookup.saveHint",
      "lookup.saving",
      "lookup.title",
      "lookup.turnSaveOn",
    ]);
    expect(paths.filter((path) => path.startsWith("settings.lookups."))).toEqual([
      "settings.lookups.heading",
      "settings.lookups.photoSave",
      "settings.lookups.saveFailed",
      "settings.lookups.textSave",
    ]);
    for (const path of [
      "log.textLookup",
      "find.description",
      "find.noMushroomDescribed",
      "find.cannotTellDescribed",
      "find.deleteConfirmDescribed",
      "queue.failed.refusedDescribed",
    ]) {
      expect(paths).toContain(path);
    }
  });

  it.each(LANGUAGES)(
    "say in %s why the edibility is unknown until the self-check agrees, the disagreement naming both species (SPEC 3.9)",
    (language) => {
      const t = STRINGS[language].find.selfCheck;
      expect(t.disagreed).toContain("{matched}");
      expect(t.disagreed).toContain("{named}");
      const unknown = STRINGS[language].find.edibilities.unknown.toLowerCase();
      for (const reason of [t.waiting, t.disagreed, t.noSpecies, t.failed, t.noPicture]) {
        expect(reason.toLowerCase()).toContain(unknown);
      }
    },
  );

  it.each(LANGUAGES)("give the count in %s with places for it", (language) => {
    expect(STRINGS[language].lookup.count).toContain("{count}");
    expect(STRINGS[language].lookup.count).toContain("{max}");
  });

  it("say in English what no mushroom and cannot tell mean for a text lookup (SPEC 3.9, Answers)", () => {
    expect(STRINGS.en.find.noMushroomDescribed).toBe("The description is not of a mushroom.");
    expect(STRINGS.en.find.cannotTellDescribed).toBe(
      "The description does not say enough to tell which species it is.",
    );
  });

  it.each(LANGUAGES)(
    "speak in %s of a description, not a photo, where a lookup has none",
    (language) => {
      const t = STRINGS[language];
      for (const text of [
        t.find.noMushroomDescribed,
        t.find.cannotTellDescribed,
        t.find.deleteConfirmDescribed,
        t.queue.failed.refusedDescribed,
      ]) {
        expect(text).not.toMatch(/photo|foto/i);
      }
    },
  );
});

describe("the disclaimer for a lookup without photos (SPEC 3.9, Answers)", () => {
  /** A disclaimer's first sentence: up to and including its first full stop and the space after it. */
  const firstSentence = (text: string) => text.slice(0, text.indexOf(". ") + 2);

  it.each(LANGUAGES)(
    "keeps the first sentence of SPEC 3.5 in %s, and replaces only the second",
    (language) => {
      const { disclaimer, disclaimerDescribed } = STRINGS[language];
      expect(firstSentence(disclaimerDescribed)).toBe(firstSentence(disclaimer));
      expect(disclaimerDescribed).not.toBe(disclaimer);
    },
  );

  it("is the English text of SPEC 3.9 as its second sentence", () => {
    expect(STRINGS.en.disclaimerDescribed).toBe(
      "The edibility shown is that of the species the app matched. There is no guarantee that the mushroom you described is that species.",
    );
  });

  it("is in Swedish and Italian the counterparts of the English, the Italian awaiting a speaker's check", () => {
    expect(STRINGS.sv.disclaimerDescribed).toBe(
      "Ätligheten som visas gäller den art som appen har matchat. Det finns ingen garanti för att svampen du har beskrivit är den arten.",
    );
    expect(STRINGS.it.disclaimerDescribed).toBe(
      "La commestibilità indicata è quella della specie individuata dall'app. Non c'è alcuna garanzia che il fungo che hai descritto sia di quella specie.",
    );
    expect(NOT_CHECKED_BY_A_SPEAKER.it).toContain("disclaimerDescribed");
    expect(NOT_CHECKED_BY_A_SPEAKER.sv).toContain("disclaimerDescribed");
  });
});

describe("the disclaimer of SPEC 3.5", () => {
  it("is the Swedish text, byte for byte", () => {
    expect(STRINGS.sv.disclaimer).toBe(
      "Ätligheten som visas gäller den art som appen har matchat. Det finns ingen garanti för att svampen på ditt foto är den arten.",
    );
    expect(utf8Hex(STRINGS.sv.disclaimer)).toBe(
      "c384746c6967686574656e20736f6d2076697361732067c3a46c6c65722064656e2061727420736f6d20617070656e20686172206d6174636861742e204465742066696e6e7320696e67656e20676172616e74692066c3b67220617474207376616d70656e2070c3a5206469747420666f746f20c3a4722064656e20617274656e2e",
    );
  });

  it("is the English text, byte for byte", () => {
    expect(STRINGS.en.disclaimer).toBe(
      "The edibility shown is that of the species the app matched. There is no guarantee that the mushroom in your photo is that species.",
    );
    expect(utf8Hex(STRINGS.en.disclaimer)).toBe(
      "5468652065646962696c6974792073686f776e2069732074686174206f662074686520737065636965732074686520617070206d6174636865642e205468657265206973206e6f2067756172616e746565207468617420746865206d757368726f6f6d20696e20796f75722070686f746f206973207468617420737065636965732e",
    );
  });

  it("is the Italian text, byte for byte", () => {
    expect(STRINGS.it.disclaimer).toBe(
      "La commestibilità indicata è quella della specie individuata dall'app. Non c'è alcuna garanzia che il fungo nella tua foto sia di quella specie.",
    );
    expect(utf8Hex(STRINGS.it.disclaimer)).toBe(
      "4c6120636f6d6d6573746962696c6974c3a020696e64696361746120c3a8207175656c6c612064656c6c612073706563696520696e6469766964756174612064616c6c276170702e204e6f6e206327c3a820616c63756e6120676172616e7a69612063686520696c2066756e676f206e656c6c612074756120666f746f20736961206469207175656c6c61207370656369652e",
    );
  });
});
