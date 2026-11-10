/**
 * The pins of the Library's map (docs/SPEC.md 3.9, The Library): the finds that pass the
 * Library's filters and lie in the area the map shows, what a tapped pin shows of its find, and
 * the newest find with a position, on which the map opens without the phone's position. It
 * renders nothing.
 *
 * A find without a position is in the list only, and a find that could not be read is never on
 * the map (SPEC 3.9), though the list always keeps it.
 */

import type { Language } from "../i18n/languages";
import type { Strings } from "../i18n/strings";
import type { FindSummary, FindTime, ListedFind } from "../store/find";
import { applyFilters, type LibraryFilters } from "./filters";
import { isInArea, type MapBounds, type Point } from "./mapArea";

/** A find on the map, at its position. */
export interface Pin {
  readonly id: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly find: FindSummary;
}

/** The finds with a position that pass `filters` and lie in `area`, in the list's order. */
export function pinsInArea(
  entries: readonly ListedFind[],
  filters: LibraryFilters,
  area: MapBounds,
): Pin[] {
  const pins: Pin[] = [];
  for (const entry of applyFilters(entries, filters)) {
    if (!entry.readable || entry.position === null) {
      continue;
    }
    const { latitude, longitude } = entry.position;
    if (isInArea({ latitude, longitude }, area)) {
      pins.push({ id: entry.id, latitude, longitude, find: entry });
    }
  }
  return pins;
}

/**
 * The position of the newest find that has one: the first in the list, which lists the latest
 * taken first; null when no readable find has one.
 */
export function newestWithPosition(entries: readonly ListedFind[]): Point | null {
  for (const entry of entries) {
    if (entry.readable && entry.position !== null) {
      return { latitude: entry.position.latitude, longitude: entry.position.longitude };
    }
  }
  return null;
}

/**
 * The date a find was taken, as the calendar showed it where it was taken (its own UTC offset),
 * in the language's form, without the time; null for an instant a date cannot hold, which only a
 * damaged file gives.
 */
export function formatFindDate(time: FindTime, language: Language): string | null {
  const local = time.takenAtMs + time.utcOffsetMinutes * 60_000;
  if (Number.isNaN(new Date(local).getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(local);
}

/**
 * What tapping a pin shows (SPEC 3.9): the species the find's answer names, in the app's
 * language, or "not identified" without one, as the species filter calls it; and its date.
 */
export function pinLabel(
  find: FindSummary,
  language: Language,
  strings: Strings,
): { title: string; date: string | null } {
  return {
    title: find.species === null ? strings.log.notIdentified : find.species[language],
    date: formatFindDate(find.time, language),
  };
}
