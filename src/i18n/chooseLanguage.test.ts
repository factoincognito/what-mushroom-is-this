import { deviceLanguage, resolveLanguage } from "./chooseLanguage";
import { FALLBACK_LANGUAGE, isLanguage } from "./languages";

describe("isLanguage", () => {
  it.each(["sv", "en", "it"])("accepts %s", (code) => {
    expect(isLanguage(code)).toBe(true);
  });

  it.each([["de"], ["SV"], [""], ["sv-SE"], [null], [undefined], [1], [{}]])(
    "rejects %p",
    (value) => {
      expect(isLanguage(value)).toBe(false);
    },
  );
});

describe("FALLBACK_LANGUAGE", () => {
  it("is English", () => {
    expect(FALLBACK_LANGUAGE).toBe("en");
  });
});

describe("deviceLanguage", () => {
  it.each([
    ["sv", "sv"],
    ["en", "en"],
    ["it", "it"],
  ])("gives %s for a phone in %s", (code, expected) => {
    expect(deviceLanguage([{ languageCode: code }])).toBe(expected);
  });

  it("reads the language code whatever its case", () => {
    expect(deviceLanguage([{ languageCode: "SV" }])).toBe("sv");
  });

  it("gives English for a phone in another language", () => {
    expect(deviceLanguage([{ languageCode: "de" }])).toBe("en");
  });

  it("takes the phone's first language only, not a later one in its list", () => {
    expect(deviceLanguage([{ languageCode: "de" }, { languageCode: "sv" }])).toBe("en");
    expect(deviceLanguage([{ languageCode: "it" }, { languageCode: "sv" }])).toBe("it");
  });

  it("gives English when the phone reports no locale", () => {
    expect(deviceLanguage([])).toBe("en");
  });

  it("gives English when the first locale has no language code", () => {
    expect(deviceLanguage([{ languageCode: null }])).toBe("en");
  });

  it.each([
    ["not an array", "sv"],
    ["null", null],
    ["undefined", undefined],
    ["an entry that is not an object", ["sv"]],
    ["an entry that is null", [null]],
    ["a language code that is not a string", [{ languageCode: 7 }]],
    ["an entry without a language code", [{ languageTag: "sv-SE" }]],
  ])("gives English for malformed input: %s", (_label, input) => {
    expect(deviceLanguage(input)).toBe("en");
  });
});

describe("resolveLanguage", () => {
  it("uses the phone's language when none is chosen", () => {
    expect(resolveLanguage(null, "sv")).toBe("sv");
  });

  it("lets a chosen language override the phone's", () => {
    expect(resolveLanguage("it", "sv")).toBe("it");
    expect(resolveLanguage("en", "it")).toBe("en");
  });
});
