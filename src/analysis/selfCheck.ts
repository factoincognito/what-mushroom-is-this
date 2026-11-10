/**
 * The self-check's comparison (docs/SPEC.md 3.9, "The self-check of a text lookup"): the species a
 * text answer names against the answer of the photo lookup on its representative picture. The two
 * match when the first two words of their Latin names, genus and species, are the same, ignoring
 * case; the check's own confidence is not used. A check answer of "no mushroom" or "cannot tell"
 * does not match, and the check could not name a species. It renders and stores nothing.
 */

import type { SelfCheckOutcome } from "../store/find";
import type { Answer, SpeciesNames } from "./answer";

/** What the check's answer comes to; "failed" and "no picture" come from elsewhere. */
export type ComparedCheck =
  | { state: "agreed" | "no-species" }
  | Extract<SelfCheckOutcome, { state: "disagreed" }>;

/**
 * What the check came to for a text answer naming `matched`: agreed, disagreed with the species
 * the check named (its names as the check gave them), or could not name a species.
 */
export function selfCheckOutcome(matched: SpeciesNames, check: Answer): ComparedCheck {
  if (check.result !== "match") {
    return { state: "no-species" };
  }
  return sameSpecies(matched.la, check.names.la)
    ? { state: "agreed" }
    : { state: "disagreed", names: check.names };
}

/**
 * Whether two Latin names have the same first two words, genus and species, ignoring case. A name
 * of fewer than two words, such as a genus alone, names no species and matches none; so does one
 * whose second word is a rank or uncertainty mark (`NOT_A_SPECIES`), such as "Boletus sp." or
 * "Amanita cf. phalloides" (Clead's decision on the review of #75, note 1).
 */
export function sameSpecies(a: string, b: string): boolean {
  const first = genusAndSpecies(a);
  return first !== null && first === genusAndSpecies(b);
}

/**
 * The marks that stand in a Latin name's second place for no species: an unnamed species or
 * several, "compare with", "akin to", a subspecies, a variety, an aggregate. They are matched
 * ignoring case, with or without their full stop.
 */
const NOT_A_SPECIES: readonly string[] = ["sp", "spp", "cf", "aff", "ssp", "subsp", "var", "agg"];

function genusAndSpecies(latin: string): string | null {
  const words = latin.trim().split(/\s+/);
  const [genus, species] = words;
  if (genus === undefined || genus === "" || species === undefined) {
    return null;
  }
  const lowered = species.toLowerCase();
  if (NOT_A_SPECIES.includes(lowered.endsWith(".") ? lowered.slice(0, -1) : lowered)) {
    return null;
  }
  return `${genus} ${species}`.toLowerCase();
}
