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
    "firstStart",
    "log",
    "settings.title",
    "settings.languageHeading",
    "settings.key",
    "settings.model",
    "notFound",
    "newFind",
  ];

  it("marks the Swedish and the Italian strings of PBI-1.1, PBI-1.2 and PBI-1.6", () => {
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
      "newFind.asking",
      "newFind.back",
      "newFind.cameraBlocked",
      "newFind.cameraDenied",
      "newFind.locationDenied",
      "newFind.openSettings",
      "newFind.pickFailed",
      "newFind.pickFromGallery",
      "newFind.retrySave",
      "newFind.saveFailed",
      "newFind.saved",
      "newFind.saving",
      "newFind.takePhoto",
      "newFind.title",
    ]);
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
