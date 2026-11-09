import { EDIBILITIES } from "../analysis/answer";
import { STRINGS } from "../i18n/strings";
import { POSITION_SOURCES, TIME_SOURCES } from "../store/find";
import {
  edibilityText,
  fillIn,
  formatAccuracy,
  formatCoordinates,
  formatFindTime,
  formatUtcOffset,
  mapLink,
  parseFindId,
  positionSourceText,
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

  it("on Android, is a geo URI that searches the coordinates, so the map app puts a pin there", () => {
    expect(mapLink(position, "android")).toBe("geo:0,0?q=59.699500,17.123457");
  });

  it("on iOS, is Apple's unified Maps URL for a place at the coordinates", () => {
    expect(mapLink(position, "ios")).toBe(
      "https://maps.apple.com/place?coordinate=59.699500,17.123457",
    );
  });

  it("on any other platform, is the geo URI", () => {
    expect(mapLink(position, "web")).toBe("geo:0,0?q=59.699500,17.123457");
  });

  it("writes negative and tiny coordinates as plain decimals, never in exponent form", () => {
    expect(mapLink({ latitude: -33.8666, longitude: 1e-7 }, "android")).toBe(
      "geo:0,0?q=-33.866600,0.000000",
    );
    expect(mapLink({ latitude: -1e-9, longitude: -0 }, "android")).toBe(
      "geo:0,0?q=0.000000,0.000000",
    );
  });

  it.each([
    [{ latitude: Number.NaN, longitude: 0 }],
    [{ latitude: 91, longitude: 0 }],
    [{ latitude: 0, longitude: -180.5 }],
    [{ latitude: 0, longitude: Number.POSITIVE_INFINITY }],
  ])("refuses a coordinate out of range: %o", (bad) => {
    expect(() => mapLink(bad, "android")).toThrow(RangeError);
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
