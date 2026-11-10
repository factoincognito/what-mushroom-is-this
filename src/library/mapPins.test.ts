import { STRINGS } from "../i18n/strings";
import type { FindSummary, ListedFind, Position } from "../store/find";
import { ALL, DEFAULT_FILTERS, type LibraryFilters, NOT_IDENTIFIED } from "./filters";
import type { MapBounds } from "./mapArea";
import { formatFindDate, newestWithPosition, pinLabel, pinsInArea } from "./mapPins";

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 8, 1, 10, 0);

const CHANTERELLE = {
  sv: "Kantarell",
  en: "Chanterelle",
  la: "Cantharellus cibarius",
  it: "Gallinaccio",
};
const FLY_AGARIC = {
  sv: "Röd flugsvamp",
  en: "Fly agaric",
  la: "Amanita muscaria",
  it: "Ovolo malefico",
};

/** Enköping, and a box of about 10 km around it. */
const HOME = { latitude: 59.64, longitude: 17.08 };
const AROUND_HOME: MapBounds = [17.0, 59.6, 17.16, 59.68];

function at(latitude: number, longitude: number): Position {
  return { latitude, longitude, accuracyM: 5, source: "fix" };
}

function summary(
  id: number,
  position: Position | null,
  species: typeof CHANTERELLE | null,
  daysLater = 0,
): { readable: true } & FindSummary {
  return {
    readable: true,
    id,
    photoUri: `file:///photos/${id}.jpg`,
    time: { takenAtMs: BASE + daysLater * DAY, utcOffsetMinutes: 120, source: "saved" },
    position,
    analysis:
      species === null
        ? { state: "waiting" }
        : {
            state: "done",
            result: "match",
            names: { sv: species.sv, en: species.en, it: species.it },
            edibility: "edible",
            confidence: 90,
          },
    answerBasis: species === null ? null : "photos",
    selfCheck: null,
    species,
    picture: null,
  };
}

describe("pinsInArea: the finds the map shows (SPEC 3.9)", () => {
  const inside = summary(1, at(59.65, 17.1), CHANTERELLE);
  const outside = summary(2, at(59.9, 17.6), CHANTERELLE);
  const noPosition = summary(3, null, CHANTERELLE);
  const unreadable: ListedFind = { readable: false, id: 4 };
  const withoutId: ListedFind = { readable: false, id: null, storedId: "5" };
  const otherSpecies = summary(6, at(59.62, 17.05), FLY_AGARIC);
  const entries: ListedFind[] = [inside, outside, noPosition, unreadable, withoutId, otherSpecies];

  it("shows the finds that lie in the area shown, with their positions, in the list's order", () => {
    expect(pinsInArea(entries, DEFAULT_FILTERS, AROUND_HOME)).toEqual([
      { id: 1, latitude: 59.65, longitude: 17.1, find: inside },
      { id: 6, latitude: 59.62, longitude: 17.05, find: otherSpecies },
    ]);
  });

  it("follows the area: a find outside one area is shown in another", () => {
    const north: MapBounds = [17.5, 59.85, 17.7, 59.95];
    expect(pinsInArea(entries, DEFAULT_FILTERS, north).map((pin) => pin.id)).toEqual([2]);
  });

  it("shows no find without a position, which is in the list only", () => {
    const everywhere: MapBounds = [-180, -85, 180, 85];
    expect(pinsInArea(entries, DEFAULT_FILTERS, everywhere).map((pin) => pin.id)).toEqual([
      1, 2, 6,
    ]);
  });

  it("never shows a find that could not be read, which the list always keeps", () => {
    const everywhere: MapBounds = [-180, -85, 180, 85];
    const ids = pinsInArea(entries, DEFAULT_FILTERS, everywhere).map((pin) => pin.id);
    expect(ids).not.toContain(4);
    expect(ids).toHaveLength(3);
  });

  it("shows only the finds that pass the filters", () => {
    const flyAgaric = { ...DEFAULT_FILTERS, species: new Set(["species:amanita muscaria"]) };
    expect(pinsInArea(entries, flyAgaric, AROUND_HOME).map((pin) => pin.id)).toEqual([6]);
    const notIdentified = { ...DEFAULT_FILTERS, species: new Set([NOT_IDENTIFIED]) };
    expect(pinsInArea(entries, notIdentified, AROUND_HOME)).toEqual([]);
    const otherYear: LibraryFilters = { species: ALL, years: new Set([2025]), months: ALL };
    expect(pinsInArea(entries, otherYear, AROUND_HOME)).toEqual([]);
  });

  it("shows nothing for a library with no finds", () => {
    expect(pinsInArea([], DEFAULT_FILTERS, AROUND_HOME)).toEqual([]);
  });
});

describe("newestWithPosition: where the map opens without the phone's position (SPEC 3.9)", () => {
  it("is the position of the first find with one in the list, which lists the newest first", () => {
    const entries: ListedFind[] = [
      summary(3, null, CHANTERELLE, 3),
      summary(2, at(59.7, 17.2), null, 2),
      summary(1, at(59.6, 17.0), CHANTERELLE, 1),
    ];
    expect(newestWithPosition(entries)).toEqual({ latitude: 59.7, longitude: 17.2 });
  });

  it("passes over a find that could not be read", () => {
    const entries: ListedFind[] = [
      { readable: false, id: 9 },
      { readable: false, id: null, storedId: null },
      summary(1, at(HOME.latitude, HOME.longitude), CHANTERELLE),
    ];
    expect(newestWithPosition(entries)).toEqual(HOME);
  });

  it("is null when no find has a position", () => {
    expect(newestWithPosition([summary(1, null, CHANTERELLE)])).toBeNull();
    expect(newestWithPosition([])).toBeNull();
  });
});

describe("formatFindDate: the date a pin shows", () => {
  it("is the date where the find was taken, in its own UTC offset, without the time", () => {
    // 23:30 UTC on 1 September is 01:30 on 2 September at UTC+02:00.
    const time = {
      takenAtMs: Date.UTC(2026, 8, 1, 23, 30),
      utcOffsetMinutes: 120,
      source: "saved" as const,
    };
    const expected = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
      Date.UTC(2026, 8, 2),
    );
    expect(formatFindDate(time, "en")).toBe(expected);
    expect(formatFindDate(time, "en")).not.toMatch(/\d:\d/);
  });

  it("is in the app's language", () => {
    const time = { takenAtMs: BASE, utcOffsetMinutes: 0, source: "saved" as const };
    for (const language of ["sv", "en", "it"] as const) {
      expect(formatFindDate(time, language)).toBe(
        new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(BASE),
      );
    }
  });

  it("is null for a time a date cannot hold, which only a damaged file gives", () => {
    expect(
      formatFindDate({ takenAtMs: 8.64e15 + 1, utcOffsetMinutes: 0, source: "saved" }, "en"),
    ).toBeNull();
  });
});

describe("pinLabel: what tapping a pin shows (SPEC 3.9)", () => {
  it("names the species in the app's language, with the find's date", () => {
    const find = summary(1, at(59.65, 17.1), CHANTERELLE);
    for (const language of ["sv", "en", "it"] as const) {
      expect(pinLabel(find, language, STRINGS[language])).toEqual({
        title: CHANTERELLE[language],
        date: formatFindDate(find.time, language),
      });
    }
  });

  it("says 'not identified' for a find without an answer naming a species", () => {
    const waiting = summary(1, at(59.65, 17.1), null);
    expect(pinLabel(waiting, "en", STRINGS.en).title).toBe(STRINGS.en.log.notIdentified);
    expect(pinLabel(waiting, "sv", STRINGS.sv).title).toBe(STRINGS.sv.log.notIdentified);
    const noMushroom: FindSummary = {
      ...waiting,
      analysis: { state: "done", result: "no_mushroom" },
    };
    expect(pinLabel(noMushroom, "it", STRINGS.it).title).toBe(STRINGS.it.log.notIdentified);
  });
});
