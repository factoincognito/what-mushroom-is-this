/**
 * The Library's filters (docs/SPEC.md 3.9, The Library): species, years and months. Each is all
 * (the default) or a choice of one or more values; a find passes when it passes each of them.
 * A find that could not be read (3.4) is always kept, whatever the filters, so it can be
 * deleted. It renders nothing.
 *
 * - Species are grouped by the first two words of the answer's Latin name, genus and species,
 *   ignoring case, as the self-check matches them (3.9), and "not identified" holds the finds
 *   without an answer naming a species (Clead's decision 3 for PBI-2.7). The answer is the find's
 *   current one, a text answer's too while its self-check waits.
 * - A find's year and month are those of its time in its own UTC offset (3.9).
 */

import type { SpeciesNames } from "../analysis/answer";
import type { Language } from "../i18n/languages";
import type { FindTime, ListedFind } from "../store/find";

/** A filter's default: every value passes. */
export const ALL = "all";

/** A filter: all values, or the values chosen, never an empty choice. */
export type Choice<T> = typeof ALL | ReadonlySet<T>;

export interface LibraryFilters {
  /** `speciesChoiceOf`'s values: a species' key, or `NOT_IDENTIFIED`. */
  readonly species: Choice<string>;
  readonly years: Choice<number>;
  /** 1 to 12. */
  readonly months: Choice<number>;
}

export const DEFAULT_FILTERS: LibraryFilters = { species: ALL, years: ALL, months: ALL };

/** The species choice of the finds without an answer naming a species. */
export const NOT_IDENTIFIED = "not-identified";

/** A species' choice is its key behind this, so that no Latin name can pass for `NOT_IDENTIFIED`. */
const SPECIES_PREFIX = "species:";

export const MONTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** The first two words of a Latin name, genus and species, in lower case; null for blanks. */
export function speciesKey(latin: string): string | null {
  const words = latin.trim().split(/\s+/).slice(0, 2);
  const key = words.join(" ").toLowerCase();
  return key.length === 0 ? null : key;
}

/** The species choice a find counts under. */
export function speciesChoiceOf(entry: ListedFind): string {
  const key = entry.readable && entry.species !== null ? speciesKey(entry.species.la) : null;
  return key === null ? NOT_IDENTIFIED : `${SPECIES_PREFIX}${key}`;
}

/**
 * The year and month (1 to 12) of a find's time, as the clock showed them where it was taken; null
 * for an instant a date cannot hold, which only a damaged file gives.
 */
export function yearMonthOf(time: FindTime): { year: number; month: number } | null {
  const local = new Date(time.takenAtMs + time.utcOffsetMinutes * 60_000);
  if (Number.isNaN(local.getTime())) {
    return null;
  }
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1 };
}

/** A species the species filter offers: its choice, and its names, or null for "not identified". */
export interface SpeciesOption {
  readonly choice: string;
  readonly names: SpeciesNames | null;
}

/**
 * The species among the finds, each once, shown by the names of its newest find (the list's
 * first), sorted by the name in the app's language; "not identified" last, when a find is.
 */
export function speciesOptions(
  entries: readonly ListedFind[],
  language: Language,
): SpeciesOption[] {
  const named = new Map<string, SpeciesNames>();
  let notIdentified = false;
  for (const entry of entries) {
    if (!entry.readable) {
      continue;
    }
    const choice = speciesChoiceOf(entry);
    if (choice === NOT_IDENTIFIED || entry.species === null) {
      notIdentified = true;
    } else if (!named.has(choice)) {
      named.set(choice, entry.species);
    }
  }
  const collator = new Intl.Collator(language);
  const options: SpeciesOption[] = [...named]
    .map(([choice, names]) => ({ choice, names }))
    .sort(
      (a, b) =>
        collator.compare(a.names[language], b.names[language]) ||
        collator.compare(a.choice, b.choice),
    );
  return notIdentified ? [...options, { choice: NOT_IDENTIFIED, names: null }] : options;
}

/** The years that have finds, each once, newest first. */
export function yearOptions(entries: readonly ListedFind[]): number[] {
  const years = new Set<number>();
  for (const entry of entries) {
    const date = entry.readable ? yearMonthOf(entry.time) : null;
    if (date !== null) {
      years.add(date.year);
    }
  }
  return [...years].sort((a, b) => b - a);
}

function passes<T>(choice: Choice<T>, value: T | null): boolean {
  return choice === ALL || (value !== null && choice.has(value));
}

/**
 * The finds that pass every filter, in the list's order, and every find that could not be read,
 * in its place. A find whose time a date cannot hold passes no choice of years or months.
 */
export function applyFilters(
  entries: readonly ListedFind[],
  filters: LibraryFilters,
): ListedFind[] {
  return entries.filter((entry) => {
    if (!entry.readable) {
      return true;
    }
    const date = yearMonthOf(entry.time);
    return (
      passes(filters.species, speciesChoiceOf(entry)) &&
      passes(filters.years, date?.year ?? null) &&
      passes(filters.months, date?.month ?? null)
    );
  });
}

/**
 * Chooses a value, or takes a chosen one away; a choice left empty is all again. The choice
 * given is not changed.
 */
export function toggle<T>(choice: Choice<T>, value: T): Choice<T> {
  const next = new Set(choice === ALL ? [] : choice);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next.size === 0 ? ALL : next;
}

/** A choice of the values still present; all when none is left. Unchanged, the same choice. */
function keepPresent<T>(choice: Choice<T>, present: ReadonlySet<T>): Choice<T> {
  if (choice === ALL || [...choice].every((value) => present.has(value))) {
    return choice;
  }
  const kept = new Set([...choice].filter((value) => present.has(value)));
  return kept.size === 0 ? ALL : kept;
}

/**
 * The filters with the chosen species and years that no find has any longer taken away, since a
 * choice is among the finds (3.9); a filter left with none is all again. Months are not taken
 * away. Unchanged, the same filters, so that a screen can set them without rendering again.
 */
export function pruneFilters(
  filters: LibraryFilters,
  entries: readonly ListedFind[],
): LibraryFilters {
  const species = keepPresent(
    filters.species,
    new Set(entries.filter((entry) => entry.readable).map(speciesChoiceOf)),
  );
  const years = keepPresent(filters.years, new Set(yearOptions(entries)));
  return species === filters.species && years === filters.years
    ? filters
    : { ...filters, species, years };
}

/** A month's name in the app's language, 1 for January. */
export function monthName(month: number, language: Language): string {
  return new Intl.DateTimeFormat(language, { month: "long", timeZone: "UTC" }).format(
    Date.UTC(2000, month - 1, 1),
  );
}
