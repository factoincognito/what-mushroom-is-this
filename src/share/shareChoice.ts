/**
 * What the choice a share opens offers (docs/SPEC.md 3.9, Shared photos; PBI-2.21), kept out of
 * the screen so that it renders nothing: "New find" for a share of one photo only, "Add to an
 * earlier find" while there is a find to choose, and the finds that list shows, as the Library
 * lists them and in its order, without its filters. A find that holds the most photos is listed
 * as full and cannot be chosen; a find that could not be read is left out.
 */

import type { FindSummary, ListedFind } from "../store/find";
import type { FindLog } from "../store/findStore";

/** A find in the choice's list. */
export interface ChoiceFind {
  readonly find: FindSummary;
  /** Whether it holds the most photos a find may, so that it cannot be chosen. */
  readonly full: boolean;
}

/**
 * The finds of the choice's list, from the Library's list and each find's number of photos: in
 * the list's order, without the finds that could not be read or whose photos could not be
 * counted.
 */
export function choiceFinds(
  entries: readonly ListedFind[],
  photoCounts: ReadonlyMap<number, number>,
  max: number,
): ChoiceFind[] {
  const finds: ChoiceFind[] = [];
  for (const entry of entries) {
    if (!entry.readable) {
      continue;
    }
    const count = photoCounts.get(entry.id);
    if (count === undefined) {
      continue;
    }
    const { readable: _readable, ...find } = entry;
    finds.push({ find, full: count >= max });
  }
  return finds;
}

/**
 * What the choice offers for the number of photos shared: "New find" for one photo, never for
 * several, and "Add to an earlier find" while a find can be chosen.
 */
export function choiceOffers(
  photos: number,
  finds: readonly ChoiceFind[],
): { newFind: boolean; add: boolean } {
  return {
    newFind: photos === 1,
    add: photos >= 1 && finds.some((find) => !find.full),
  };
}

/**
 * Reads the finds for the choice: the Library's list, and each readable find in full, for the
 * number of photos it holds, which the list does not give. A find that is gone or cannot be read
 * by then is left out. It rejects when the list itself cannot be read.
 */
export async function readChoiceFinds(
  log: Pick<FindLog, "list" | "getStored">,
  max: number,
): Promise<ChoiceFind[]> {
  const entries = await log.list();
  const counts = new Map<number, number>();
  for (const entry of entries) {
    if (!entry.readable) {
      continue;
    }
    try {
      const stored = await log.getStored(entry.id);
      if (stored !== null) {
        counts.set(entry.id, stored.photos.length);
      }
    } catch {
      // The find cannot be read in full: it is left out, as one the list could not read.
    }
  }
  return choiceFinds(entries, counts, max);
}
