import { EDIBILITIES } from "../analysis/answer";
import { STRINGS } from "../i18n/strings";
import { POSITION_SOURCES, TIME_SOURCES } from "../store/find";
import {
  checkedEdibility,
  confidenceText,
  edibilityText,
  fillIn,
  formatAccuracy,
  formatCoordinates,
  formatFindTime,
  formatUtcOffset,
  mapLink,
  parseFindId,
  positionSourceText,
  selfCheckReason,
  timeSourceText,
} from "./display";

describe("parseFindId", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["9007199254740991", 9_007_199_254_740_991],
  ])("reads the route's ID %s as the number %d", (param, id) => {
    expect(parseFindId(param)).toBe(id);
  });

  it.each([
    ["an empty text", ""],
    ["zero", "0"],
    ["a leading zero", "01"],
    ["a sign", "+1"],
    ["a minus", "-1"],
    ["a decimal", "1.0"],
    ["an exponent", "1e3"],
    ["blanks around it", " 1 "],
    ["letters", "abc"],
    ["hex", "0x1"],
    ["more than a safe integer", "9007199254740993"],
    ["an array", ["1"]],
    ["a number, not a text", 1],
    ["undefined", undefined],
    ["null", null],
  ])("refuses %s, with no coercion", (_name, param) => {
    expect(parseFindId(param)).toBeNull();
  });
});

describe("formatUtcOffset", () => {
  it.each([
    [0, "UTC+00:00"],
    [60, "UTC+01:00"],
    [120, "UTC+02:00"],
    [330, "UTC+05:30"],
    [-300, "UTC-05:00"],
    [-570, "UTC-09:30"],
    [840, "UTC+14:00"],
    [-1080, "UTC-18:00"],
  ])("gives %d minutes as %s", (minutes, label) => {
    expect(formatUtcOffset(minutes)).toBe(label);
  });

  it.each([[1.5], [Number.NaN], [1081], [-1081]])("refuses %d", (minutes) => {
    expect(() => formatUtcOffset(minutes)).toThrow(RangeError);
  });
});

describe("formatFindTime", () => {
  const OPTIONS = { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" } as const;

  it("gives the time at the find's own offset, with the offset, in the language", () => {
    const takenAtMs = Date.UTC(2026, 8, 14, 13, 42);
    const local = Date.UTC(2026, 8, 14, 15, 42);
    expect(formatFindTime({ takenAtMs, utcOffsetMinutes: 120, source: "photo" }, "en")).toBe(
      `${new Intl.DateTimeFormat("en", OPTIONS).format(local)} UTC+02:00`,
    );
  });

  it("does not depend on the phone's own time zone, and crosses midnight at the offset", () => {
    const text = formatFindTime(
      { takenAtMs: Date.UTC(2026, 8, 14, 23, 30), utcOffsetMinutes: 60, source: "saved" },
      "sv",
    );
    expect(text).toContain("00:30");
    expect(text).toContain("15");
    expect(text.endsWith("UTC+01:00")).toBe(true);
  });

  it("gives a negative offset", () => {
    const text = formatFindTime(
      { takenAtMs: Date.UTC(2026, 0, 2, 3, 4), utcOffsetMinutes: -300, source: "photo" },
      "it",
    );
    expect(text).toContain("22:04");
    expect(text.endsWith("UTC-05:00")).toBe(true);
  });
});

describe("formatCoordinates and formatAccuracy", () => {
  it("gives latitude and longitude to five decimals", () => {
    expect(
      formatCoordinates({ latitude: 59.6995, longitude: -17.1234567, accuracyM: 8, source: "fix" }),
    ).toBe("59.69950, -17.12346");
  });

  it("gives no minus for a coordinate that rounds to zero", () => {
    expect(
      formatCoordinates({ latitude: -0.000001, longitude: -0, accuracyM: null, source: "fix" }),
    ).toBe("0.00000, 0.00000");
  });

  it("gives the accuracy in whole metres, or null when the phone gave none", () => {
    expect(formatAccuracy({ latitude: 1, longitude: 2, accuracyM: 12.6, source: "fix" })).toBe(
      "13",
    );
    expect(formatAccuracy({ latitude: 1, longitude: 2, accuracyM: 0.2, source: "fix" })).toBe("0");
    expect(
      formatAccuracy({ latitude: 1, longitude: 2, accuracyM: null, source: "photo" }),
    ).toBeNull();
  });
});

describe("mapLink", () => {
  const position = { latitude: 59.6995, longitude: 17.1234567 };

  const ANDROID = { OS: "android", Version: 35 };
  const UNIFIED = "https://maps.apple.com/place?coordinate=59.699500,17.123457";
  const QUERY = "https://maps.apple.com/?ll=59.699500,17.123457&q=59.699500,17.123457";

  it("on Android, is a geo URI that searches the coordinates, so the map app puts a pin there", () => {
    expect(mapLink(position, ANDROID)).toBe("geo:0,0?q=59.699500,17.123457");
  });

  it.each(["18.4", "18.4.1", "18.10", "19.0", "26", "26.1"])(
    "on iOS %s (18.4 or later), is Apple's unified Maps URL for a place at the coordinates",
    (version) => {
      expect(mapLink(position, { OS: "ios", Version: version })).toBe(UNIFIED);
    },
  );

  it.each(["18.3", "18.3.2", "18", "17.6", "16.4", "", "beta", "18.x"])(
    "on iOS %s (before 18.4, or a version it cannot read), is the older query form",
    (version) => {
      expect(mapLink(position, { OS: "ios", Version: version })).toBe(QUERY);
    },
  );

  it("on iOS with a version that is not text, is the older query form", () => {
    expect(mapLink(position, { OS: "ios", Version: 18.4 })).toBe(QUERY);
  });

  it("on any other platform, is the geo URI", () => {
    expect(mapLink(position, { OS: "web", Version: "" })).toBe("geo:0,0?q=59.699500,17.123457");
  });

  it("writes negative and tiny coordinates as plain decimals, never in exponent form", () => {
    expect(mapLink({ latitude: -33.8666, longitude: 1e-7 }, ANDROID)).toBe(
      "geo:0,0?q=-33.866600,0.000000",
    );
    expect(mapLink({ latitude: -1e-9, longitude: -0 }, ANDROID)).toBe(
      "geo:0,0?q=0.000000,0.000000",
    );
    expect(mapLink({ latitude: -33.8666, longitude: 1e-7 }, { OS: "ios", Version: "17.0" })).toBe(
      "https://maps.apple.com/?ll=-33.866600,0.000000&q=-33.866600,0.000000",
    );
  });

  it.each([
    [{ latitude: Number.NaN, longitude: 0 }],
    [{ latitude: 91, longitude: 0 }],
    [{ latitude: 0, longitude: -180.5 }],
    [{ latitude: 0, longitude: Number.POSITIVE_INFINITY }],
  ])("refuses a coordinate out of range: %o", (bad) => {
    expect(() => mapLink(bad, ANDROID)).toThrow(RangeError);
    expect(() => mapLink(bad, { OS: "ios", Version: "18.4" })).toThrow(RangeError);
  });
});

describe("the texts of a find's values", () => {
  it.each(["sv", "en", "it"] as const)("names every edibility in %s, each differently", (lang) => {
    const texts = EDIBILITIES.map((edibility) => edibilityText(edibility, STRINGS[lang]));
    expect(new Set(texts).size).toBe(EDIBILITIES.length);
    expect(edibilityText("deadly_poisonous", STRINGS[lang])).toBe(
      STRINGS[lang].find.edibilities.deadlyPoisonous,
    );
    expect(edibilityText("edible_after_preparation", STRINGS[lang])).toBe(
      STRINGS[lang].find.edibilities.edibleAfterPreparation,
    );
  });

  it("gives Claude's confidence from 1 to 100 as a number of 100 (SPEC 3.9)", () => {
    expect(confidenceText(90, STRINGS.en)).toBe("Claude's confidence in the match: 90 of 100");
    expect(confidenceText(1, STRINGS.sv)).toBe("Claudes säkerhet om matchningen: 1 av 100");
    expect(confidenceText(100, STRINGS.it)).toBe(
      "Sicurezza di Claude sulla corrispondenza: 100 su 100",
    );
  });

  it.each(["low", "medium", "high"] as const)(
    "gives a Phase 1 find's level %s in words, as before (SPEC 3.9)",
    (level) => {
      for (const lang of ["sv", "en", "it"] as const) {
        const t = STRINGS[lang].find;
        expect(confidenceText(level, STRINGS[lang])).toBe(
          fillIn(t.confidence, { confidence: t.confidences[level] }),
        );
      }
    },
  );

  it.each(["sv", "en", "it"] as const)("names every time and position source in %s", (lang) => {
    const t = STRINGS[lang].find;
    expect(TIME_SOURCES.map((source) => timeSourceText(source, STRINGS[lang]))).toEqual([
      t.timeSources.saved,
      t.timeSources.photo,
      t.timeSources.photoPhoneOffset,
    ]);
    expect(POSITION_SOURCES.map((source) => positionSourceText(source, STRINGS[lang]))).toEqual([
      t.positionSources.fix,
      t.positionSources.lastKnown,
      t.positionSources.photo,
    ]);
  });
});

describe("fillIn", () => {
  it("fills every placeholder named, and leaves an unknown one as it is", () => {
    expect(fillIn("{a} and {b}, {a}; {c}", { a: "x", b: "y" })).toBe("x and y, x; {c}");
  });

  it("puts a value in as text, so a $ pattern in it is not read as one", () => {
    expect(fillIn("[{a}]", { a: "$& $1" })).toBe("[$& $1]");
  });
});

describe("the edibility of an answer from text alone, until its self-check agrees (SPEC 3.9)", () => {
  const sure = { edibility: "edible", confidence: 90 } as const;
  const matched = { sv: "Kantarell", en: "Chanterelle", it: "Gallinaccio" };
  const named = {
    sv: "Narrkantarell",
    en: "False chanterelle",
    la: "Hygrophoropsis aurantiaca",
    it: "Falso gallinaccio",
  };

  it.each([
    ["waiting", { state: "waiting" }],
    ["disagreed", { state: "disagreed", names: named }],
    ["no-species", { state: "no-species" }],
    ["failed", { state: "failed" }],
    ["no-picture", { state: "no-picture" }],
  ] as const)("is unknown while the check is %s, whatever the answer said", (_, check) => {
    expect(checkedEdibility(sure, check)).toBe("unknown");
  });

  it("is the answer's, by the confidence line, once the check agreed", () => {
    expect(checkedEdibility(sure, { state: "agreed" })).toBe("edible");
    expect(checkedEdibility({ edibility: "edible", confidence: 69 }, { state: "agreed" })).toBe(
      "unknown",
    );
  });

  it("is the answer's, by the confidence line, for an answer from photos, which has no check", () => {
    expect(checkedEdibility(sure, null)).toBe("edible");
    expect(checkedEdibility({ edibility: "poisonous", confidence: "low" }, null)).toBe("unknown");
  });

  it.each([
    ["waiting", { state: "waiting" }, STRINGS.en.find.selfCheck.waiting],
    ["no-species", { state: "no-species" }, STRINGS.en.find.selfCheck.noSpecies],
    ["failed", { state: "failed" }, STRINGS.en.find.selfCheck.failed],
    ["no-picture", { state: "no-picture" }, STRINGS.en.find.selfCheck.noPicture],
  ] as const)("says why while the check is %s", (_, check, reason) => {
    expect(selfCheckReason(check, matched, "en", STRINGS.en)).toBe(reason);
  });

  it.each(["sv", "en", "it"] as const)(
    "names both species in %s when the check named another",
    (language) => {
      const reason = selfCheckReason(
        { state: "disagreed", names: named },
        matched,
        language,
        STRINGS[language],
      );
      expect(reason).toBe(
        fillIn(STRINGS[language].find.selfCheck.disagreed, {
          matched: matched[language],
          named: named[language],
        }),
      );
      expect(reason).toContain(matched[language]);
      expect(reason).toContain(named[language]);
    },
  );

  it("gives no reason once the check agreed, or for an answer from photos", () => {
    expect(selfCheckReason({ state: "agreed" }, matched, "en", STRINGS.en)).toBeNull();
    expect(selfCheckReason(null, matched, "en", STRINGS.en)).toBeNull();
  });
});
