/**
 * The Library's filters (docs/SPEC.md 3.9, The Library): species, years and months, their
 * defaults, a find's year and month in its own UTC offset, and finds that could not be read
 * always kept.
 */

import type { SpeciesNames } from "../analysis/answer";
import type { FindSummary, ListedFind, SummaryAnalysis } from "../store/find";
import {
  ALL,
  applyFilters,
  DEFAULT_FILTERS,
  type LibraryFilters,
  MONTHS,
  monthName,
  NOT_IDENTIFIED,
  pruneFilters,
  speciesChoiceOf,
  speciesKey,
  speciesOptions,
  toggle,
  yearMonthOf,
  yearOptions,
} from "./filters";

const CHANTERELLE: SpeciesNames = {
  sv: "Kantarell",
  en: "Chanterelle",
  la: "Cantharellus cibarius",
  it: "Gallinaccio",
};
const PORCINI: SpeciesNames = {
  sv: "Karljohanssvamp",
  en: "Porcini",
  la: "Boletus edulis",
  it: "Porcino",
};
const FLY_AGARIC: SpeciesNames = {
  sv: "Röd flugsvamp",
  en: "Fly agaric",
  la: "Amanita muscaria",
  it: "Ovolo malefico",
};

/** A readable find taken at `iso` (UTC) with the offset given, its answer naming `species`. */
function entry(
  id: number,
  iso: string,
  species: SpeciesNames | null,
  utcOffsetMinutes = 60,
  analysis?: SummaryAnalysis,
): ListedFind {
  const summary: FindSummary = {
    id,
    photoUri: `file:///photos/${id}.jpg`,
    time: { takenAtMs: Date.parse(iso), utcOffsetMinutes, source: "saved" },
    position: null,
    analysis:
      analysis ??
      (species === null
        ? { state: "waiting" }
        : {
            state: "done",
            result: "match",
            names: { sv: species.sv, en: species.en, it: species.it },
            edibility: "edible",
            confidence: 90,
          }),
    selfCheck: null,
    species,
    picture: null,
  };
  return { readable: true, ...summary };
}

const unreadable: ListedFind = { readable: false, id: 50 };
const withoutId: ListedFind = { readable: false, id: null, storedId: "0" };

function ids(entries: readonly ListedFind[]): (number | string | null)[] {
  return entries.map((found) =>
    found.id === null && !found.readable ? `stored-${found.storedId}` : found.id,
  );
}

describe("speciesKey: genus and species, ignoring case (SPEC 3.9; Clead's decision 3)", () => {
  it.each([
    ["Cantharellus cibarius", "cantharellus cibarius"],
    ["CANTHARELLUS Cibarius", "cantharellus cibarius"],
    ["  Boletus   edulis  ", "boletus edulis"],
    ["Boletus edulis var. arcticus", "boletus edulis"],
    ["Boletus\tedulis", "boletus edulis"],
    ["Russula", "russula"],
  ])("%j is %j", (latin, key) => {
    expect(speciesKey(latin)).toBe(key);
  });

  it.each(["", "   "])("gives null for a name of blanks only (%j)", (latin) => {
    expect(speciesKey(latin)).toBeNull();
  });
});

describe("speciesChoiceOf", () => {
  it("groups a find by its current answer's Latin name", () => {
    expect(speciesChoiceOf(entry(1, "2026-09-01T10:00:00Z", CHANTERELLE))).toBe(
      "species:cantharellus cibarius",
    );
  });

  it("does not let a Latin name pass for 'not identified'", () => {
    const odd = { ...CHANTERELLE, la: NOT_IDENTIFIED };
    expect(speciesChoiceOf(entry(1, "2026-09-01T10:00:00Z", odd))).not.toBe(NOT_IDENTIFIED);
  });

  it.each<[string, SummaryAnalysis]>([
    ["waiting", { state: "waiting" }],
    ["failed", { state: "failed", failure: { cause: "request", detail: "x" } }],
    ["no mushroom", { state: "done", result: "no_mushroom" }],
    ["cannot tell", { state: "done", result: "cannot_tell" }],
  ])("counts a find that is %s as not identified", (_name, analysis) => {
    expect(speciesChoiceOf(entry(1, "2026-09-01T10:00:00Z", null, 60, analysis))).toBe(
      NOT_IDENTIFIED,
    );
  });

  it("counts a find whose answer's Latin name is blank as not identified", () => {
    const blank = { ...CHANTERELLE, la: "  " };
    expect(speciesChoiceOf(entry(1, "2026-09-01T10:00:00Z", blank))).toBe(NOT_IDENTIFIED);
  });
});

describe("yearMonthOf: in the find's own UTC offset (SPEC 3.9)", () => {
  it("takes the year and month of the clock where the find was taken", () => {
    const time = { takenAtMs: Date.parse("2026-09-01T10:00:00Z"), utcOffsetMinutes: 0 };
    expect(yearMonthOf({ ...time, source: "saved" })).toEqual({ year: 2026, month: 9 });
  });

  it("moves into the next year east of UTC", () => {
    const takenAtMs = Date.parse("2025-12-31T23:30:00Z");
    expect(yearMonthOf({ takenAtMs, utcOffsetMinutes: 60, source: "saved" })).toEqual({
      year: 2026,
      month: 1,
    });
    expect(yearMonthOf({ takenAtMs, utcOffsetMinutes: 0, source: "saved" })).toEqual({
      year: 2025,
      month: 12,
    });
  });

  it("moves into the month before west of UTC", () => {
    const takenAtMs = Date.parse("2026-03-01T03:00:00Z");
    expect(yearMonthOf({ takenAtMs, utcOffsetMinutes: -300, source: "photo" })).toEqual({
      year: 2026,
      month: 2,
    });
  });

  it("gives null for an instant a date cannot hold", () => {
    expect(
      yearMonthOf({ takenAtMs: 9_007_199_254_740_991, utcOffsetMinutes: 0, source: "saved" }),
    ).toBeNull();
  });
});

describe("speciesOptions: the species among the finds", () => {
  it("lists each species once, by the newest find's names, sorted by the name in the app's language, with 'not identified' last", () => {
    const options = speciesOptions(
      [
        entry(5, "2026-09-05T10:00:00Z", null),
        entry(4, "2026-09-04T10:00:00Z", {
          ...PORCINI,
          en: "King bolete",
          la: "BOLETUS EDULIS var. arcticus",
        }),
        entry(3, "2026-09-03T10:00:00Z", CHANTERELLE),
        entry(2, "2026-09-02T10:00:00Z", PORCINI),
        unreadable,
        withoutId,
        entry(1, "2026-09-01T10:00:00Z", FLY_AGARIC),
      ],
      "en",
    );
    expect(options).toEqual([
      { choice: "species:cantharellus cibarius", names: CHANTERELLE },
      { choice: "species:amanita muscaria", names: FLY_AGARIC },
      {
        choice: "species:boletus edulis",
        names: { ...PORCINI, en: "King bolete", la: "BOLETUS EDULIS var. arcticus" },
      },
      { choice: NOT_IDENTIFIED, names: null },
    ]);
  });

  it("sorts by the names in Swedish for Swedish", () => {
    const options = speciesOptions(
      [
        entry(1, "2026-09-01T10:00:00Z", FLY_AGARIC),
        entry(2, "2026-09-02T10:00:00Z", PORCINI),
        entry(3, "2026-09-03T10:00:00Z", CHANTERELLE),
      ],
      "sv",
    );
    expect(options.map((option) => option.names?.sv)).toEqual([
      "Kantarell",
      "Karljohanssvamp",
      "Röd flugsvamp",
    ]);
  });

  it("keeps two species of one name in the app's language apart, sorted by Latin name", () => {
    const other: SpeciesNames = { ...CHANTERELLE, la: "Cantharellus amethysteus" };
    const options = speciesOptions(
      [entry(1, "2026-09-01T10:00:00Z", CHANTERELLE), entry(2, "2026-09-02T10:00:00Z", other)],
      "en",
    );
    expect(options.map((option) => option.choice)).toEqual([
      "species:cantharellus amethysteus",
      "species:cantharellus cibarius",
    ]);
  });

  it("has no 'not identified' when every find names a species, and nothing for no finds", () => {
    expect(speciesOptions([entry(1, "2026-09-01T10:00:00Z", CHANTERELLE)], "en")).toEqual([
      { choice: "species:cantharellus cibarius", names: CHANTERELLE },
    ]);
    expect(speciesOptions([unreadable, withoutId], "en")).toEqual([]);
  });
});

describe("yearOptions: the years that have finds", () => {
  it("lists each year once, newest first, in each find's own offset, ignoring finds that could not be read", () => {
    expect(
      yearOptions([
        entry(1, "2025-12-31T23:30:00Z", null, 60),
        entry(2, "2024-06-01T10:00:00Z", CHANTERELLE),
        entry(3, "2026-02-01T10:00:00Z", PORCINI),
        unreadable,
        withoutId,
        entry(4, "2024-07-01T10:00:00Z", null),
      ]),
    ).toEqual([2026, 2024]);
  });

  it("leaves out a find whose time a date cannot hold", () => {
    const far = entry(1, "2026-09-01T10:00:00Z", null);
    if (!far.readable) {
      throw new Error("not readable");
    }
    expect(
      yearOptions([{ ...far, time: { ...far.time, takenAtMs: 9_007_199_254_740_991 } }]),
    ).toEqual([]);
  });
});

describe("applyFilters", () => {
  const entries: ListedFind[] = [
    entry(6, "2026-09-10T10:00:00Z", CHANTERELLE),
    unreadable,
    entry(5, "2026-08-10T10:00:00Z", PORCINI),
    entry(4, "2025-09-10T10:00:00Z", { ...CHANTERELLE, la: "cantharellus CIBARIUS" }),
    entry(3, "2025-12-31T23:30:00Z", null, 60),
    entry(2, "2025-07-10T10:00:00Z", null, 60, { state: "done", result: "no_mushroom" }),
    withoutId,
  ];

  it("keeps every find with the defaults: all species, all years, all months", () => {
    expect(DEFAULT_FILTERS).toEqual({ species: ALL, years: ALL, months: ALL });
    expect(applyFilters(entries, DEFAULT_FILTERS)).toEqual(entries);
  });

  it("keeps the finds of the chosen species, grouped by Latin name, and those that could not be read, in place", () => {
    const filters: LibraryFilters = {
      ...DEFAULT_FILTERS,
      species: new Set(["species:cantharellus cibarius"]),
    };
    expect(ids(applyFilters(entries, filters))).toEqual([6, 50, 4, "stored-0"]);
  });

  it("keeps the finds without an answer naming a species under 'not identified'", () => {
    const filters: LibraryFilters = { ...DEFAULT_FILTERS, species: new Set([NOT_IDENTIFIED]) };
    expect(ids(applyFilters(entries, filters))).toEqual([50, 3, 2, "stored-0"]);
  });

  it("keeps the finds of any of several chosen species", () => {
    const filters: LibraryFilters = {
      ...DEFAULT_FILTERS,
      species: new Set(["species:boletus edulis", NOT_IDENTIFIED]),
    };
    expect(ids(applyFilters(entries, filters))).toEqual([50, 5, 3, 2, "stored-0"]);
  });

  it("keeps the finds of the chosen years, by their own offset", () => {
    const filters: LibraryFilters = { ...DEFAULT_FILTERS, years: new Set([2026]) };
    expect(ids(applyFilters(entries, filters))).toEqual([6, 50, 5, 3, "stored-0"]);
  });

  it("keeps the finds of the chosen months, of any year", () => {
    const filters: LibraryFilters = { ...DEFAULT_FILTERS, months: new Set([9, 7]) };
    expect(ids(applyFilters(entries, filters))).toEqual([6, 50, 4, 2, "stored-0"]);
  });

  it("keeps only finds that pass every filter", () => {
    const filters: LibraryFilters = {
      species: new Set(["species:cantharellus cibarius", NOT_IDENTIFIED]),
      years: new Set([2025]),
      months: new Set([9, 12]),
    };
    expect(ids(applyFilters(entries, filters))).toEqual([50, 4, "stored-0"]);
  });

  it("keeps the finds that could not be read when no other find passes", () => {
    const filters: LibraryFilters = { ...DEFAULT_FILTERS, years: new Set([1999]) };
    expect(ids(applyFilters(entries, filters))).toEqual([50, "stored-0"]);
  });

  it("leaves out a find whose time a date cannot hold once a year or month is chosen", () => {
    const far = entry(1, "2026-09-01T10:00:00Z", null);
    if (!far.readable) {
      throw new Error("not readable");
    }
    const odd: ListedFind = { ...far, time: { ...far.time, takenAtMs: 9_007_199_254_740_991 } };
    expect(applyFilters([odd], DEFAULT_FILTERS)).toEqual([odd]);
    expect(applyFilters([odd], { ...DEFAULT_FILTERS, months: new Set([9]) })).toEqual([]);
  });
});

describe("toggle: choosing and unchoosing", () => {
  it("chooses one value from all", () => {
    expect(toggle(ALL, 2026)).toEqual(new Set([2026]));
  });

  it("adds a value, and takes a chosen one away", () => {
    expect(toggle(new Set([1]), 2)).toEqual(new Set([1, 2]));
    expect(toggle(new Set([1, 2]), 1)).toEqual(new Set([2]));
  });

  it("goes back to all when the last chosen value is taken away", () => {
    expect(toggle(new Set([3]), 3)).toBe(ALL);
  });

  it("does not change the set it was given", () => {
    const chosen = new Set([1]);
    toggle(chosen, 2);
    expect(chosen).toEqual(new Set([1]));
  });
});

describe("pruneFilters: a choice is among the finds", () => {
  const entries = [
    entry(2, "2026-09-02T10:00:00Z", CHANTERELLE),
    entry(1, "2025-09-01T10:00:00Z", null),
    unreadable,
  ];

  it("drops a chosen species or year no find has any longer", () => {
    const filters: LibraryFilters = {
      species: new Set(["species:cantharellus cibarius", "species:boletus edulis"]),
      years: new Set([2026, 2024]),
      months: new Set([1]),
    };
    expect(pruneFilters(filters, entries)).toEqual({
      species: new Set(["species:cantharellus cibarius"]),
      years: new Set([2026]),
      months: new Set([1]),
    });
  });

  it("goes back to all when no chosen species or year is left", () => {
    const filters: LibraryFilters = {
      species: new Set(["species:boletus edulis"]),
      years: new Set([2024]),
      months: ALL,
    };
    expect(pruneFilters(filters, entries)).toEqual(DEFAULT_FILTERS);
  });

  it("keeps a chosen 'not identified' while a find is not identified", () => {
    const filters: LibraryFilters = { ...DEFAULT_FILTERS, species: new Set([NOT_IDENTIFIED]) };
    expect(pruneFilters(filters, entries)).toBe(filters);
    expect(pruneFilters(filters, [entries[0] as ListedFind])).toEqual(DEFAULT_FILTERS);
  });

  it("gives the same filters back when nothing is dropped", () => {
    const filters: LibraryFilters = {
      species: new Set(["species:cantharellus cibarius"]),
      years: new Set([2025]),
      months: new Set([12]),
    };
    expect(pruneFilters(filters, entries)).toBe(filters);
    expect(pruneFilters(DEFAULT_FILTERS, [])).toBe(DEFAULT_FILTERS);
  });
});

describe("the months", () => {
  it("are the twelve, January first", () => {
    expect(MONTHS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it.each([
    ["en", 1, "January"],
    ["en", 12, "December"],
    ["sv", 1, "januari"],
    ["sv", 9, "september"],
    ["it", 1, "gennaio"],
    ["it", 12, "dicembre"],
  ] as const)("in %s, month %d is %s", (language, month, name) => {
    expect(monthName(month, language)).toBe(name);
  });
});
