import { LANGUAGES, type Language } from "../i18n/languages";
import { STRINGS } from "../i18n/strings";
import { formatFindDate } from "../library/mapPins";
import { fs, PROJECT_ROOT, path } from "../testing/projectFiles";
import { BUILD_VERSION } from "./buildVersion";
import {
  ENTRIES_NOT_CHECKED_BY_A_SPEAKER,
  formatEntryDate,
  HISTORY,
  type HistoryEntry,
  isCalendarDate,
} from "./entries";
import { compareVersions, parseVersion, type Version } from "./version";

/** The `version` of app.json, read from the file itself. */
const appJson: { expo: { version: unknown } } = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "app.json"), "utf8"),
);

function versionOf(entry: HistoryEntry): Version {
  const version = parseVersion(entry.version);
  if (version === null) {
    throw new Error(`the entry's version ${entry.version} is not a version`);
  }
  return version;
}

describe("the build's version (SPEC 3.10, item 5)", () => {
  it("is the version of app.json, read from the imported file", () => {
    expect(BUILD_VERSION).toBe(appJson.expo.version);
  });

  it("is a version: three whole numbers, and nothing else", () => {
    expect(parseVersion(appJson.expo.version)).not.toBeNull();
  });
});

describe("the list of entries (SPEC 3.10, item 4)", () => {
  it("is not empty", () => {
    expect(HISTORY.length).toBeGreaterThan(0);
  });

  it("has the version of app.json as its first entry, so a version cannot be set without writing what it brings", () => {
    expect(HISTORY[0]?.version).toBe(appJson.expo.version);
  });

  it.each(HISTORY)("has a version that is a version: $version", (entry) => {
    expect(parseVersion(entry.version)).not.toBeNull();
  });

  it("has no two entries with the same version", () => {
    const versions = HISTORY.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("is in descending order of version, newest first", () => {
    for (let index = 1; index < HISTORY.length; index += 1) {
      const newer = HISTORY[index - 1] as HistoryEntry;
      const older = HISTORY[index] as HistoryEntry;
      expect(compareVersions(versionOf(newer), versionOf(older))).toBeGreaterThan(0);
    }
  });

  it.each(HISTORY)("has a date that is a real calendar date, for $version", (entry) => {
    expect(entry.date).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
    expect(isCalendarDate(entry.date)).toBe(true);
  });

  it.each(HISTORY)("has the lines of exactly the three app languages, for $version", (entry) => {
    expect(Object.keys(entry.lines).sort()).toEqual([...LANGUAGES].sort());
  });

  describe.each(HISTORY)("the entry of $version", (entry) => {
    it.each(LANGUAGES)("has at least one line in %s, none empty or only spaces", (language) => {
      const lines = entry.lines[language];
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(typeof line).toBe("string");
        expect(line.trim()).not.toBe("");
      }
    });

    it("has the same number of lines in the three languages", () => {
      expect(entry.lines.sv).toHaveLength(entry.lines.en.length);
      expect(entry.lines.it).toHaveLength(entry.lines.en.length);
    });

    it("is written for the user: no PR or backlog number, and no name from the code (item 10)", () => {
      for (const language of LANGUAGES) {
        for (const line of entry.lines[language]) {
          expect(line).not.toMatch(/#[0-9]/);
          expect(line).not.toMatch(/\bPBI\b|\bPO-[0-9]/);
          expect(line).not.toMatch(/`|\bsrc\/|\.tsx?\b|\(\)/);
        }
      }
    });

    it.each(["sv", "it"] as const)("is translated in %s, not left in English", (language) => {
      entry.lines[language].forEach((line, index) => {
        expect(line).not.toBe(entry.lines.en[index]);
      });
    });
  });

  it("holds the versions from before the history that were installed on a phone: 0.2.0 and 0.1.0 (item 4)", () => {
    const versions = HISTORY.map((entry) => entry.version);
    expect(versions).toContain("0.2.0");
    expect(versions).toContain("0.1.0");
  });
});

describe("the entry of 0.2.1, the first version with the history (Adam, 2026-11-26)", () => {
  /** The lines of the entry of 0.2.1 in a language. */
  function linesOf(language: Language): readonly string[] {
    const entry = HISTORY.find((candidate) => candidate.version === "0.2.1");
    if (entry === undefined) {
      throw new Error("the list has no entry of 0.2.1");
    }
    return entry.lines[language];
  }

  /** The places of the lines that hold every one of the texts, counted from 0. */
  function placesOfLinesWith(language: Language, texts: readonly string[]): number[] {
    return linesOf(language).flatMap((line, index) =>
      texts.every((text) => line.includes(text)) ? [index] : [],
    );
  }

  /** The two choices of a shared photo, as the choice names them (SPEC 3.9, Shared photos). */
  function choicesOfAShare(language: Language): readonly string[] {
    return [STRINGS[language].share.newFind, STRINGS[language].share.addToFind];
  }

  /** The history's link and the screen it is on, as the app names them (SPEC 3.10, item 2). */
  function linkOnAbout(language: Language): readonly string[] {
    return [STRINGS[language].history.title, STRINGS[language].about.title];
  }

  /** What opens by itself after an upgrade, by its title (SPEC 3.10, item 3). */
  function whatOpensByItself(language: Language): readonly string[] {
    return [STRINGS[language].history.whatsNewTitle];
  }

  it.each(LANGUAGES)(
    "tells in %s of the share target: one line names a shared photo's two choices as the choice does",
    (language) => {
      expect(placesOfLinesWith(language, choicesOfAShare(language))).toHaveLength(1);
    },
  );

  it.each(LANGUAGES)(
    "tells in %s of the version history: one line names its link and the About screen as the app does",
    (language) => {
      expect(placesOfLinesWith(language, linkOnAbout(language))).toHaveLength(1);
    },
  );

  it.each(LANGUAGES)(
    "tells in %s of what opens by itself after an upgrade, by its title",
    (language) => {
      expect(placesOfLinesWith(language, whatOpensByItself(language))).toHaveLength(1);
    },
  );

  it.each([
    ["the share's two choices", choicesOfAShare],
    ["the history's link on About", linkOnAbout],
    ["what opens by itself", whatOpensByItself],
  ] as const)(
    "has the line of %s at the same place in the three languages, line for line",
    (_what, texts) => {
      const [first, ...others] = LANGUAGES.map((language) =>
        placesOfLinesWith(language, texts(language)),
      );
      expect(first).toHaveLength(1);
      for (const places of others) {
        expect(places).toEqual(first);
      }
    },
  );
});

describe("the entries no speaker has checked (SPEC 3.10, item 10)", () => {
  it("are every entry, in Swedish and in Italian, until a speaker has checked it", () => {
    const all = HISTORY.map((entry) => entry.version);
    expect(ENTRIES_NOT_CHECKED_BY_A_SPEAKER).toEqual({ sv: all, it: all });
  });

  it.each(["sv", "it"] as const)(
    "names in %s only versions the list holds, each once",
    (language) => {
      const versions = HISTORY.map((entry) => entry.version);
      const unchecked = ENTRIES_NOT_CHECKED_BY_A_SPEAKER[language];
      for (const version of unchecked) {
        expect(versions).toContain(version);
      }
      expect(new Set(unchecked).size).toBe(unchecked.length);
    },
  );
});

describe("a real calendar date written YYYY-MM-DD (SPEC 3.10, item 4)", () => {
  it.each(["2026-11-16", "2026-01-01", "2026-12-31", "2028-02-29", "2000-02-29", "0099-03-01"])(
    "is %s",
    (date) => {
      expect(isCalendarDate(date)).toBe(true);
    },
  );

  it.each([
    ["the 30th of February", "2026-02-30"],
    ["the 29th of February in a year that is no leap year", "2026-02-29"],
    ["the 29th of February 1900, no leap year", "1900-02-29"],
    ["the 31st of November", "2026-11-31"],
    ["a 13th month", "2026-13-01"],
    ["a month 0", "2026-00-10"],
    ["a day 0", "2026-11-00"],
    ["a day 32", "2026-01-32"],
    ["a month and a day of one digit", "2026-1-5"],
    ["a year of two digits", "26-11-16"],
    ["a time after it", "2026-11-16T00:00:00Z"],
    ["a space before it", " 2026-11-16"],
    ["a line break after it", "2026-11-16\n"],
    ["slashes", "2026/11/16"],
    ["the day first", "16-11-2026"],
    ["full-width digits", "２０２６-11-16"],
    ["nothing", ""],
  ])("is not %s", (_what, date) => {
    expect(isCalendarDate(date)).toBe(false);
  });

  it.each([null, undefined, 20261116, new Date(Date.UTC(2026, 10, 16))])(
    "is not what is no text: %p",
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );
});

describe("an entry's date as shown (SPEC 3.10, item 3)", () => {
  it.each(LANGUAGES)("has in %s the form a find's date has on the map", (language) => {
    const noonThatDay = { takenAtMs: Date.UTC(2026, 10, 16, 12), utcOffsetMinutes: 0 };
    const onTheMap = formatFindDate({ ...noonThatDay, source: "saved" }, language);
    expect(onTheMap).not.toBeNull();
    expect(formatEntryDate("2026-11-16", language)).toBe(onTheMap);
  });

  it("is the entry's own day: the 16th of November 2026 in English", () => {
    const shown = formatEntryDate("2026-11-16", "en");
    expect(shown).toContain("16");
    expect(shown).toContain("2026");
    expect(shown).toMatch(/Nov/);
  });

  it("differs between the languages", () => {
    expect(formatEntryDate("2026-10-05", "sv")).toMatch(/okt/);
    expect(formatEntryDate("2026-10-05", "it")).toMatch(/ott/);
    expect(formatEntryDate("2026-10-05", "en")).toMatch(/Oct/);
  });

  it("is the first and the last day of a year as written", () => {
    expect(formatEntryDate("2026-01-01", "en")).toMatch(/Jan 1, 2026/);
    expect(formatEntryDate("2026-12-31", "en")).toMatch(/Dec 31, 2026/);
  });

  it("is nothing for a date that is no calendar date", () => {
    expect(formatEntryDate("2026-02-30", "en")).toBeNull();
    expect(formatEntryDate("soon", "en")).toBeNull();
  });
});
